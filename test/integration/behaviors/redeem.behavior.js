const ethers = require('ethers');
const { assert } = require('../../contracts/common');
const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../../../index');
const { ensureBalance } = require('../utils/balances');
const { skipWaitingPeriod } = require('../utils/skip');
const { increaseStalePeriodAndCheckRatesAndCache } = require('../utils/rates');

function itCanRedeem({ ctx }) {
	describe('redemption of deprecated synths', () => {
		let owner;
		let someUser;
		let Synthetix, Issuer, SynthToRedeem, SynthhUSD, SynthToRedeemProxy, SynthRedeemer;
		let totalDebtBeforeRemoval;
		let synth;

		before('target contracts and users', () => {
			// sETH and sBTC can't be removed because the debt may be too large for removeSynth to not underflow
			// during debt update, so sETHBTC is used here
			synth = 'sETHBTC';

			({
				Synthetix,
				Issuer,
				[`Synth${synth}`]: SynthToRedeem,
				[`Proxy${synth}`]: SynthToRedeemProxy,
				SynthhUSD,
				SynthRedeemer,
			} = ctx.contracts);

			({ owner, someUser } = ctx.users);
		});

		before('ensure the user has hUSD', async () => {
			await ensureBalance({
				ctx,
				symbol: 'hUSD',
				user: someUser,
				balance: ethers.utils.parseEther('100'),
			});
		});

		before(`ensure the user has some of the target synth`, async () => {
			await ensureBalance({
				ctx,
				symbol: synth,
				user: someUser,
				balance: ethers.utils.parseEther('100'),
			});
		});

		before('skip waiting period', async () => {
			await skipWaitingPeriod({ ctx });
		});

		before('update rates and take snapshot if needed', async () => {
			await increaseStalePeriodAndCheckRatesAndCache({ ctx });
		});

		before('record total system debt', async () => {
			totalDebtBeforeRemoval = await Issuer.totalIssuedSynths(toBytes32('hUSD'), true);
		});

		describe(`deprecating the synth`, () => {
			before(`when the owner removes the synth`, async () => {
				Issuer = Issuer.connect(owner);
				// note: this sets the synth as redeemed and cannot be undone without
				// redeploying locally or restarting a fork
				const tx = await Issuer.removeSynth(toBytes32(synth));
				await tx.wait();
			});

			it('then the total system debt is unchanged', async () => {
				assert.bnEqual(
					await Issuer.totalIssuedSynths(toBytes32('hUSD'), true),
					totalDebtBeforeRemoval
				);
			});
			it(`and the synth is removed from the system`, async () => {
				assert.equal(await Synthetix.synths(toBytes32(synth)), ZERO_ADDRESS);
			});
			describe('user redemption', () => {
				let hUSDBeforeRedemption;
				before(async () => {
					hUSDBeforeRedemption = await SynthhUSD.balanceOf(someUser.address);
				});

				before(`when the user redeems their synth`, async () => {
					SynthRedeemer = SynthRedeemer.connect(someUser);
					const tx = await SynthRedeemer.redeem(SynthToRedeemProxy.address);
					await tx.wait();
				});

				it(`then the user has no more synth`, async () => {
					assert.equal(await SynthToRedeem.balanceOf(someUser.address), '0');
				});

				it('and they have more hUSD again', async () => {
					assert.bnGt(await SynthhUSD.balanceOf(someUser.address), hUSDBeforeRedemption);
				});
			});
		});
	});
}

module.exports = {
	itCanRedeem,
};
