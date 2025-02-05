'use strict';

const DuskToken = artifacts.require('DuskToken');
const Prestaking = artifacts.require('PrestakingProvisioner');

let tokenInstance;
let prestakingInstance;

async function advanceTime(time) {
	let id = Date.now();

	return new Promise((resolve, reject) => {
		web3.currentProvider.send({
			jsonrpc: "2.0",
			method: "evm_increaseTime",
			params: [time],
			id: id
		},
		err1 => {
			if (err1) return reject(err1); 

			web3.currentProvider.send({
				jsonrpc: "2.0",
				method: "evm_mine",
				id: id + 1
			},
			(err2, res) => {
				return err2 ? reject(err2) : resolve(res);
			});
		});
	});
};

contract('Prestaking', async (accounts) => {
	before(async () => {
		tokenInstance = await DuskToken.deployed();
		prestakingInstance = await Prestaking.deployed();
		await tokenInstance.transfer(prestakingInstance.address, '10000000000000000000000000', 
			{ from: accounts[0], gas: '1000000' });
		await tokenInstance.transfer(accounts[1], '250000000000000000000000', { from: accounts[0], gas: '1000000' });
		await tokenInstance.transfer(accounts[2], '500000000000000000000000', { from: accounts[0], gas: '1000000' });
		await tokenInstance.transfer(accounts[3], '100000000000000000000000', { from: accounts[0], gas: '1000000' });
		await tokenInstance.transfer(accounts[4], '250000000000000000000000', { from: accounts[0], gas: '1000000' });
		await tokenInstance.transfer(accounts[5], '250000000000000000000000', { from: accounts[0], gas: '1000000' });
		await tokenInstance.transfer(accounts[6], '250000000000000000000000', { from: accounts[0], gas: '1000000' });
	});
	

	describe('pre-timetravel', () => {
		it('should properly set the owner', async () => {
			let owner = await prestakingInstance.owner();
			assert.strictEqual(owner, accounts[0]);
		});
		
		it('should not allow a user to stake, if they have not given the contract any approval', async () => {
			// The contract will be deployed with a min/max stake set to 250000.
			try {
				await prestakingInstance.stake({ from: accounts[1], gas: '1000000' });

				// This should not succeed
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow a user to stake, if they have not given the contract a proper approval', async () => {
			try {
				await tokenInstance.approve(prestakingInstance.address, 1000000000000000, { from: accounts[3], gas: '1000000' });
				await prestakingInstance.stake(1000000000000000, { from: accounts[3], gas: '1000000' });

				// This should not succeed
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should allow the user to stake, once a proper approval has been given', async () => {
			await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('250000', 'ether'), { from: accounts[1], gas: '1000000' });
			await prestakingInstance.stake(web3.utils.toWei('250000', 'ether'), { from: accounts[1], gas: '1000000' });

			// Check that the new information is correct.
			let currentTime = Math.floor(Date.now()/1000) + 5;
			let staker = await prestakingInstance.stakersMap.call(accounts[1], { from: accounts[1] });
			assert.isAtMost(staker.startTime.toNumber(), currentTime);
			assert.strictEqual(staker.amount.toString(), "250000000000000000000000");
			assert.strictEqual(staker.endTime.toString(), "0");
			assert.strictEqual(staker.accumulatedReward.toString(), "0");
			assert.strictEqual(staker.pendingReward.toString(), "0");
			assert.isAtMost(staker.startTime.toNumber(), currentTime);
			// 250000 * 0.0002 = 50
			assert.strictEqual(staker.dailyReward.toString(), web3.utils.toWei('50', 'ether'));
		});

		it('should not allow a user to stake twice', async () => {
			try {
				await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('250000', 'ether'), { from: accounts[1], gas: '1000000' });
				await prestakingInstance.stake(web3.utils.toWei('250000', 'ether'), { from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should only allow a staker to start a reward withdrawal call', async () => {
			try {
				await prestakingInstance.startWithdrawReward({ from: accounts[9], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should only allow a staker to finalize a reward withdrawal call', async () => {
			try {
				await prestakingInstance.withdrawReward({ from: accounts[9], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should only allow a staker to start a stake withdrawal call', async () => {
			try {
				await prestakingInstance.startWithdrawStake({ from: accounts[9], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should only allow a staker to finalize a stake withdrawal call', async () => {
			try {
				await prestakingInstance.withdrawStake({ from: accounts[9], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow a staker to withdraw rewards before the first day has passed', async () => {
			try {
				await prestakingInstance.startWithdrawReward({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});

	// Now, fast-forward a day, to set this staker to `active`
	describe('first timetravel', () => {
		before(async () => {
			await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('500000', 'ether'), { from: accounts[2], gas: '1000000' });
			await prestakingInstance.stake(web3.utils.toWei('500000', 'ether'), { from: accounts[2], gas: '1000000' });
			await advanceTime(24*60*60);
		});

		it('should not allow a staker to withdraw their stake before the first thirty days have passed', async () => {
			try {
				await prestakingInstance.startWithdrawStake({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow a staker to withdraw a reward without starting the cooldown first', async () => {
			try {
				await prestakingInstance.withdrawReward({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow a staker to withdraw their stake without starting the cooldown first', async () => {
			try {
				await prestakingInstance.withdrawStake({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});

	// Fast-forward 7 days, to allow for some reward accumulation.
	describe('second timetravel', () => {
		before(async () => {
			await advanceTime(7*24*60*60);
		});

		it('should allow a staker to start their withdrawal cooldown, after waiting for the initial period', async () => {
			await prestakingInstance.startWithdrawReward({ from: accounts[1], gas: '1000000' });

			// Staker has been staking for 8 days, meaning that he should be getting:
			// 8 * (250000 * 0.0002) = 400
			let staker = await prestakingInstance.stakersMap.call(accounts[1], { from: accounts[1] });
			assert.strictEqual(staker.pendingReward.toString(), web3.utils.toWei('400', 'ether'));
			assert.strictEqual(staker.accumulatedReward.toString(), "0");
			assert.notEqual(staker.cooldownTime.toNumber(), 0);
		});

		it('should not allow the staker to withdraw their reward before the cooldown has ended', async () => {
			try {
				await prestakingInstance.withdrawReward({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow a staker to start the cooldown if it has already started', async () => {
			try {
				await prestakingInstance.startWithdrawReward({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});

	// Fast-forward 8 days, to ensure that the reward can now be collected.
	describe('third timetravel', () => {
		before(async () => {
			await advanceTime(8*24*60*60);
		});

		it('should allow a staker to collect their reward after waiting for the cooldown to end', async () => {
			await prestakingInstance.withdrawReward({ from: accounts[1], gas: '1000000' });

			let staker = await prestakingInstance.stakersMap.call(accounts[1], { from: accounts[1] });
			assert.strictEqual(staker.pendingReward.toString(), "0");
			assert.strictEqual(staker.cooldownTime.toString(), "0");
			let balance = await tokenInstance.balanceOf.call(accounts[1], { from: accounts[1] });
			assert.strictEqual(balance.toString(), web3.utils.toWei('400', 'ether'))
		});
	});

	// Fast-forward another 15 days, so that the staker can withdraw their stake.
	describe('fourth timetravel', () => {
		before(async () => {
			await advanceTime(15*24*60*60);
		});

		it('should not allow a staker to startStakeWithdrawalAfterDeactivation', async () => {
			try {
				await prestakingInstance.startWithdrawStakeAfterDeactivation({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should allow a staker to start the stake withdrawal cooldown after 30 days', async () => {
			await prestakingInstance.startWithdrawStake({ from: accounts[1], gas: '1000000' });

			// Staker should have accumulated another 23 days of rewards.
			// 23 * (250000 * 0.0002) = 1150
			let staker = await prestakingInstance.stakersMap.call(accounts[1], { from: accounts[1] });
			assert.strictEqual(staker.accumulatedReward.toString(), web3.utils.toWei('1150', 'ether'));
		});

		it('should not allow the staker to withdraw his stake before the cooldown ends', async () => {
			try {
				await prestakingInstance.withdrawStake({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should no longer allow the staker to start reward withdrawal after triggering stake withdrawal', async () => {
			try {
				await prestakingInstance.startWithdrawReward({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow the staker to start the stake withdrawal cooldown more than once', async () => {
			try {
				await prestakingInstance.startWithdrawStake({ from: accounts[1], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});

	// Fast-forward 8 more days, for the staker to be able to withdraw his stake.
	describe('fifth timetravel', () => {
		before(async () => {
			await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('250000', 'ether'), { from: accounts[4], gas: '1000000' });
			await prestakingInstance.stake(web3.utils.toWei('250000', 'ether'), { from: accounts[4], gas: '1000000' });
			await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('250000', 'ether'), { from: accounts[6], gas: '1000000' });
			await prestakingInstance.stake(web3.utils.toWei('250000', 'ether'), { from: accounts[6], gas: '1000000' });
			await advanceTime(8*24*60*60);
			await prestakingInstance.startWithdrawReward({ from: accounts[4], gas: '1000000' });
			await prestakingInstance.startWithdrawReward({ from: accounts[6], gas: '1000000' });
			await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('250000', 'ether'), { from: accounts[5], gas: '1000000' });
			await prestakingInstance.stake(web3.utils.toWei('250000', 'ether'), { from: accounts[5], gas: '1000000' });
		});

		it('should allow a staker to withdraw his stake after the cooldown', async () => {
			await prestakingInstance.withdrawStake({ from: accounts[1], gas: '1000000' });

			// Check that the staker got his money
			// He should have gotten his initial stake, the first reward withdrawal, and the remaining reward
			// credited to his account, which is 400 + 250000 + 1150 = 251550
			let balance = await tokenInstance.balanceOf.call(accounts[1], { from: accounts[1] });
			assert.strictEqual(balance.toString(), web3.utils.toWei('251550', 'ether'));
		});

		it('should delete the staker from the storage after his stake is withdrawn', async () => {
			let staker = await prestakingInstance.stakersMap.call(accounts[1], { from: accounts[1] });
			assert.strictEqual(staker.startTime.toString(), "0");
			assert.strictEqual(staker.amount.toString(), "0");
			assert.strictEqual(staker.endTime.toString(), "0");
			assert.strictEqual(staker.accumulatedReward.toString(), "0");
			assert.strictEqual(staker.pendingReward.toString(), "0");
			assert.strictEqual(staker.dailyReward.toString(), "0");
			assert.strictEqual(staker.lastUpdated.toString(), "0");
		});

		it('should not let a staker start the stake withdrawal when in reward withdrawal cooldown', async() => {
			await prestakingInstance.startWithdrawReward({ from: accounts[2], gas: '1000000' });

			try {
				await prestakingInstance.startWithdrawStake({ from: accounts[2], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should allow the owner to return stakes when the contract is active', async () => {
			let staker = await prestakingInstance.stakersMap.call(accounts[4], { from: accounts[4] });
			let balance = staker.amount.add(staker.accumulatedReward).add(staker.pendingReward);
			await prestakingInstance.returnStake(accounts[4], { from: accounts[0], gas: '10000000' });
			let tokenBalance = await tokenInstance.balanceOf(accounts[4], { from: accounts[4], gas: '1000000' });
			assert.strictEqual(balance.toString(), tokenBalance.toString());
		});
	});

	describe('activity toggle', () => {
		it('should not allow a non-owner to deactivate the contract', async () => {
			try {
				await prestakingInstance.deactivate({ from: accounts[9], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should allow the owner to deactivate the contract', async () => {
			await prestakingInstance.deactivate({ from: accounts[0], gas: '1000000' });
		});

		it('should not allow anyone to stake, while the contract is inactive', async () => {
			try {
				await tokenInstance.approve(prestakingInstance.address, web3.utils.toWei('250000', 'ether'), { from: accounts[4], gas: '1000000' });
				await prestakingInstance.stake(web3.utils.toWei('250000', 'ether'), { from: accounts[4], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow withdrawing rewards when the contract is inactive', async () => {
			try {
				await prestakingInstance.startWithdrawReward({ from: accounts[5], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow withdrawing stake normally when the contract is inactive', async () => {
			try {
				await prestakingInstance.startWithdrawStake({ from: accounts[5], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow the staker to withdraw during inactivity if his initial lock-up has not yet passed', async () => {
			try {
				advanceTime(2*24*60*60);
				await prestakingInstance.startWithdrawStakeAfterDeactivation({ from: accounts[5], gas: '10000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not distribute more rewards if the contract is inactive', async () => {
			let staker = await prestakingInstance.stakersMap.call(accounts[5], { from: accounts[5] });
			let balance = staker.amount.add(staker.accumulatedReward).add(staker.pendingReward);

			advanceTime(31*24*60*60);

			await prestakingInstance.startWithdrawStakeAfterDeactivation({ from: accounts[5], gas: '10000000' });
			let newStaker = await prestakingInstance.stakersMap.call(accounts[5], { from: accounts[5] });
			let newBalance = newStaker.amount.add(newStaker.accumulatedReward).add(newStaker.pendingReward);

			assert.strictEqual(balance.toString(), newBalance.toString());
		});

		it('should not allow the staker to withdraw multiple times during inactivity', async () =>{
			try {
				advanceTime(2*24*60*60);
				await prestakingInstance.startWithdrawStakeAfterDeactivation({ from: accounts[5], gas: '10000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should not allow the staker to withdraw during inactivity if his reward withdrawal cooldown has not passed', async () => {
			try {
				await prestakingInstance.startWithdrawStakeAfterDeactivation({ from: accounts[6], gas: '10000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});

	describe('owner functionality', () => {
		it('should not allow a non-owner to send a stake back', async () => {
			try {
				await prestakingInstance.returnStake(accounts[2], { from: accounts[2], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});

		it('should allow the owner to send a stake back', async () => {
			let staker = await prestakingInstance.stakersMap.call(accounts[2], { from: accounts[2] });
			let balance = staker.amount.add(staker.accumulatedReward).add(staker.pendingReward);
			await prestakingInstance.returnStake(accounts[2], { from: accounts[0], gas: '10000000' });

			let tokenBalance = await tokenInstance.balanceOf.call(accounts[2], { from: accounts[2] });
			assert.strictEqual(balance.toString(), tokenBalance.toString());
		});

		it('should not allow to return the stake of a user that has not staked', async () => {
			try {
				await prestakingInstance.returnStake(accounts[9], { from: accounts[0], gas: '1000000' });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});

	describe("misc", () => {
		it('should revert when ether is sent', async () => {
			try {
				await web3.sendTransaction({ to: prestakingInstance.address, from: accounts[0], value: web3.toWei("0.5", "ether") });
				assert(false);
			} catch(e) {
				assert(true);
			}
		});
	});
});