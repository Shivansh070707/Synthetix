const ethers = require('ethers');
const { toBytes32 } = require('../../../index');
const { assert, addSnapshotBeforeRestoreAfter } = require('../../contracts/common');
const { ensureBalance } = require('../utils/balances');
const { skipMinimumStakeTime } = require('../utils/skip');
const { createMockAggregatorFactory } = require('../../utils/index')();

function itCanStake({ ctx }) {
	describe('staking and claiming', () => {
		const HAKAAmount = ethers.utils.parseEther('1000');
		const amountToIssueAndBurnhUSD = ethers.utils.parseEther('1');

		let tx;
		let user, owner;
		let aggregator;
		let AddressResolver, Synthetix, SynthetixDebtShare, SynthhUSD, Issuer;
		let balancehUSD, debthUSD;

		addSnapshotBeforeRestoreAfter();

		before('target contracts and users', () => {
			({ AddressResolver, Synthetix, SynthetixDebtShare, SynthhUSD, Issuer } = ctx.contracts);

			user = ctx.users.otherUser;
			owner = ctx.users.owner;
		});

		before('ensure the user has enough HAKA', async () => {
			await ensureBalance({ ctx, symbol: 'HAKA', user, balance: HAKAAmount });
		});

		before('setup mock debt ratio aggregator', async () => {
			const MockAggregatorFactory = await createMockAggregatorFactory(owner);
			aggregator = (await MockAggregatorFactory.deploy()).connect(owner);

			tx = await aggregator.setDecimals(27);
			await tx.wait();

			const { timestamp } = await ctx.provider.getBlock();
			// debt share ratio of 0.5
			tx = await aggregator.setLatestAnswer(ethers.utils.parseUnits('0.5', 27), timestamp);
			await tx.wait();
		});

		before('import the aggregator to the resolver', async () => {
			AddressResolver = AddressResolver.connect(owner);
			tx = await AddressResolver.importAddresses(
				[toBytes32('ext:AggregatorDebtRatio')],
				[aggregator.address]
			);
			await tx.wait();
		});

		before('rebuild caches', async () => {
			tx = await Issuer.connect(owner).rebuildCache();
			await tx.wait();
		});

		describe('when the user issues hUSD', () => {
			before('record balances', async () => {
				balancehUSD = await SynthhUSD.balanceOf(user.address);
				debthUSD = await SynthetixDebtShare.balanceOf(user.address);
			});

			before('issue hUSD', async () => {
				Synthetix = Synthetix.connect(user);

				const tx = await Synthetix.issueSynths(amountToIssueAndBurnhUSD);
				const { gasUsed } = await tx.wait();
				console.log(`issueSynths() gas used: ${Math.round(gasUsed / 1000).toString()}k`);
			});

			it('issues the expected amount of hUSD', async () => {
				assert.bnEqual(
					await SynthhUSD.balanceOf(user.address),
					balancehUSD.add(amountToIssueAndBurnhUSD)
				);
			});

			it('issues the expected amount of debt shares', async () => {
				// mints (amountToIssueAndBurnhUSD / ratio) = debt shares
				assert.bnEqual(
					await SynthetixDebtShare.balanceOf(user.address),
					debthUSD.add(amountToIssueAndBurnhUSD.mul(2))
				);
			});

			describe('when the user issues hUSD again', () => {
				before('record balances', async () => {
					balancehUSD = await SynthhUSD.balanceOf(user.address);
					debthUSD = await SynthetixDebtShare.balanceOf(user.address);
				});

				before('issue hUSD', async () => {
					const tx = await Synthetix.issueSynths(amountToIssueAndBurnhUSD.mul(2));
					await tx.wait();
				});

				it('issues the expected amount of hUSD', async () => {
					assert.bnEqual(
						await SynthhUSD.balanceOf(user.address),
						balancehUSD.add(amountToIssueAndBurnhUSD.mul(2))
					);
				});

				it('issues the expected amount of debt shares', async () => {
					// mints (amountToIssueAndBurnhUSD / ratio) = debt shares
					assert.bnEqual(
						await SynthetixDebtShare.balanceOf(user.address),
						debthUSD.add(amountToIssueAndBurnhUSD.mul(4))
					);
				});

				describe('when the user burns this new amount of hUSD', () => {
					before('record balances', async () => {
						balancehUSD = await SynthhUSD.balanceOf(user.address);
						debthUSD = await SynthetixDebtShare.balanceOf(user.address);
					});

					before('skip min stake time', async () => {
						await skipMinimumStakeTime({ ctx });
					});

					before('burn hUSD', async () => {
						const tx = await Synthetix.burnSynths(amountToIssueAndBurnhUSD);
						await tx.wait();
					});

					it('debt should decrease', async () => {
						assert.bnEqual(
							await SynthhUSD.balanceOf(user.address),
							balancehUSD.sub(amountToIssueAndBurnhUSD)
						);
					});

					it('debt share should decrease correctly', async () => {
						// burns (amountToIssueAndBurnhUSD / ratio) = debt shares
						assert.bnEqual(
							await SynthetixDebtShare.balanceOf(user.address),
							debthUSD.sub(amountToIssueAndBurnhUSD.mul(2))
						);
					});
				});
			});
		});

		describe('when the user burns hUSD again', () => {
			before('skip min stake time', async () => {
				await skipMinimumStakeTime({ ctx });
			});

			before('record debt', async () => {
				debthUSD = await Synthetix.debtBalanceOf(user.address, toBytes32('hUSD'));
			});

			before('burn hUSD', async () => {
				Synthetix = Synthetix.connect(user);

				const tx = await Synthetix.burnSynths(amountToIssueAndBurnhUSD);
				const { gasUsed } = await tx.wait();
				console.log(`burnSynths() gas used: ${Math.round(gasUsed / 1000).toString()}k`);
			});

			it('reduces the expected amount of debt', async () => {
				const newDebthUSD = await Synthetix.debtBalanceOf(user.address, toBytes32('hUSD'));
				const debtReduction = debthUSD.sub(newDebthUSD);

				const tolerance = ethers.utils.parseUnits('0.01', 'ether');
				assert.bnClose(
					debtReduction.toString(),
					amountToIssueAndBurnhUSD.toString(),
					tolerance.toString()
				);
			});

			it('reduces the expected amount of debt shares', async () => {
				// burns (amountToIssueAndBurnhUSD / ratio) = debt shares
				assert.bnEqual(
					await SynthetixDebtShare.balanceOf(user.address),
					amountToIssueAndBurnhUSD.mul(2)
				);
			});
		});
	});
}

module.exports = {
	itCanStake,
};
