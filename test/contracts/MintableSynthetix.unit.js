const { artifacts, contract, web3 } = require('hardhat');
const { assert } = require('./common');
const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { toWei } = web3.utils;
const { toBytes32 } = require('../..');
const BN = require('bn.js');
const { smock } = require('@defi-wonderland/smock');

const MintableSynthetix = artifacts.require('MintableSynthetix');

contract('MintableSynthetix (unit tests)', accounts => {
	const [owner, synthetixBridgeToBase, user1, mockAddress] = accounts;

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: MintableSynthetix.abi,
			ignoreParents: ['BaseSynthetix'],
			expected: [],
		});
	});

	describe('initial setup, smock all deps', () => {
		let resolver;
		let tokenState;
		let proxy;
		let rewardsDistribution;
		let systemStatus;
		let rewardEscrowV2;
		const SYNTHETIX_TOTAL_SUPPLY = toWei('100000000');

		beforeEach(async () => {
			tokenState = await smock.fake('TokenState');
			proxy = await smock.fake('Proxy');
			rewardsDistribution = await smock.fake('IRewardsDistribution');
			resolver = await artifacts.require('AddressResolver').new(owner);
			systemStatus = await artifacts.require('SystemStatus').new(owner);
			rewardEscrowV2 = await smock.fake('IRewardEscrowV2');
			await resolver.importAddresses(
				[
					'SynthetixBridgeToBase',
					'SystemStatus',
					'Exchanger',
					'Issuer',
					'SupplySchedule',
					'Liquidator',
					'LiquidatorRewards',
					'RewardsDistribution',
					'RewardEscrowV2',
				].map(toBytes32),
				[
					synthetixBridgeToBase,
					systemStatus.address,
					mockAddress,
					mockAddress,
					mockAddress,
					mockAddress,
					mockAddress,
					rewardsDistribution.address,
					rewardEscrowV2.address,
				],
				{ from: owner }
			);
		});

		beforeEach(async () => {
			// stubs
			tokenState.setBalanceOf.returns(() => {});
			tokenState.balanceOf.returns(() => web3.utils.toWei('1'));
			proxy._emit.returns(() => {});
			rewardsDistribution.distributeRewards.returns(() => true);
		});

		describe('when the target is deployed', () => {
			let instance;
			beforeEach(async () => {
				instance = await artifacts
					.require('MintableSynthetix')
					.new(proxy.address, tokenState.address, owner, SYNTHETIX_TOTAL_SUPPLY, resolver.address);
				await instance.rebuildCache();
			});

			it('should set constructor params on deployment', async () => {
				assert.equal(await instance.proxy(), proxy.address);
				assert.equal(await instance.tokenState(), tokenState.address);
				assert.equal(await instance.owner(), owner);
				assert.equal(await instance.totalSupply(), SYNTHETIX_TOTAL_SUPPLY);
				assert.equal(await instance.resolver(), resolver.address);
			});

			describe('mintSecondary()', async () => {
				describe('failure modes', () => {
					it('should only allow SynthetixBridgeToBase to call mintSecondary()', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.mintSecondary,
							args: [user1, 100],
							address: synthetixBridgeToBase,
							accounts,
							reason: 'Can only be invoked by bridge',
						});
					});
				});

				describe('when invoked by the bridge', () => {
					const amount = 100;
					beforeEach(async () => {
						await instance.mintSecondary(user1, amount, {
							from: synthetixBridgeToBase,
						});
					});

					it('should increase the total supply', async () => {
						const newSupply = new BN(SYNTHETIX_TOTAL_SUPPLY).add(new BN(amount));
						assert.bnEqual(await instance.totalSupply(), newSupply);
					});
				});
			});

			describe('mintSecondaryRewards()', async () => {
				const amount = 100;
				describe('failure modes', () => {
					it('should only allow SynthetixBridgeToBase to call mintSecondaryRewards()', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.mintSecondaryRewards,
							args: [amount],
							address: synthetixBridgeToBase,
							accounts,
							reason: 'Can only be invoked by bridge',
						});
					});
				});

				describe('when invoked by the bridge', () => {
					beforeEach(async () => {
						await instance.mintSecondaryRewards(amount, {
							from: synthetixBridgeToBase,
						});
					});

					it('should increase the total supply', async () => {
						const newSupply = new BN(SYNTHETIX_TOTAL_SUPPLY).add(new BN(amount));
						assert.bnEqual(await instance.totalSupply(), newSupply);
					});
				});
			});

			describe('burnSecondary()', async () => {
				const amount = 100;
				describe('failure modes', () => {
					it('should only allow SynthetixBridgeToBase to call burnSecondary()', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.burnSecondary,
							args: [user1, amount],
							address: synthetixBridgeToBase,
							accounts,
							reason: 'Can only be invoked by bridge',
						});
					});
				});
				describe('when invoked by the bridge', () => {
					beforeEach(async () => {
						await instance.burnSecondary(user1, amount, {
							from: synthetixBridgeToBase,
						});
					});

					it('should decrease the total supply', async () => {
						const newSupply = new BN(SYNTHETIX_TOTAL_SUPPLY).sub(new BN(amount));
						assert.bnEqual(await instance.totalSupply(), newSupply);
					});
				});
			});
		});
	});
});
