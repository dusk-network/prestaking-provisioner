# DUSK Provisioner Pre-staking Contract

This document aims to explain the inner workings of the DUSK Provisioner Pre-staking contract.

## Introduction

The goal of this contract is to allow holders of the DUSK ERC-20 token to lock up their funds, in return for a daily reward. The rules are as follows:
- A stake becomes 'active' (eligible for reaping rewards) 24 hours after submission.
- Rewards are allocated on a per-day basis, meaning that for every 24 hours that a stake is active, a reward is given. If a stake is withdrawn anywhere before the 24-hour mark, that days reward is forfeited.
- Stakes may only be withdrawn after having staked for 30 days or more.
- Rewards are distributed according to stake size, and the % reward is always fixed, no matter how many people join in.
- Each action performed by a staker has a 7 day cooldown, meaning that a reward or stake can only be actually withdrawn after 7 days of initially requesting so.
- The daily reward and the minimum/maximum staking amounts should be hardcoded, in order to save gas.

## The contract

### Composition

The contract is composed from OpenZeppelin base contracts, and inherits the `Ownable` contract. Additionally, it uses `SafeERC20` and `SafeMath`.

```
using SafeERC20 for IERC20;
using SafeMath for uint256;
```

### Variables

Next up, we define a global variable which should hold the contract address of the DUSK token.

```
// The DUSK contract.
IERC20 private _token;
```

This variable is set in the constructor.

Then, we declare a struct, which is a collection of information related to stakers, participating in the pre-staking campaign through this contract.

```
struct Staker {
    uint    startTime;
    uint    endTime;
    uint256 amount;
    uint256 accumulatedReward;
    uint    cooldownTime;
    uint256 pendingReward;
    uint256 dailyReward;
    uint    lastUpdated;
}
```

`startTime` and `endTime` are pretty self-explanatory. Just for clarity, `endTime` is set once the staker enters a request for withdrawing their stake, and not once their stake is withdrawn fully (as their details are deleted at that point in time).

The `amount` will store however much has been staked by this individual. 

The `accumulatedReward` will count up as time progresses, and represents the amount of DUSK that a staker can withdraw at any point in time.

The `cooldownTime` logs when a staker enters a request to withdraw their `accumulatedReward`, and is used to check when the cooldown has expired.

The `pendingReward` saves an amount of DUSK upon entering a request for withdrawing rewards, and represents the amount of DUSK that will be released after the cooldown ends. When not in cooldown, this variable should always be 0.

The `dailyReward` is set on this struct to save operations done during [reward distribution](#reward-distribution).

Finally, the `lastUpdated` variable is kept on this struct as well, to save the point up to which rewards have been calculated.

Before moving on, we declare a few more global variables for the contract.

```
mapping(address => Staker) public stakersMap;
uint256 public dailyRewardPercentage;
uint256 public stakersAmount;
```

`stakersMap` is a mapping of stakers addresses, to their information, stored in a `Staker` struct.

`dailyRewardPercentage` should be self-explanatory.

And we also declare a variable to hold the amount of stakers active in the contract at any given time.

```
uint public deactivationTime;
```

This variable is set when the contract is deactivated, and should hold the exact timestamp of when this happened. This is used to stop reward distribution at the end of the campaign.

### Constructor

The constructor is used to initialise a couple of the aforementioned [global variables](#variables).

```
constructor(IERC20 token, uint256 rewardPercentage) public {
    _token = token;
    dailyRewardPercentage = reward;
}
```

It simply sets the token contract address and the daily reward.

### Modifiers

Besides the inherited `onlyOwner`, the contract itself has a few modifiers. The first is `onlyStaker`.

```
modifier onlyStaker() {
    Staker storage staker = stakersMap[msg.sender];
    require(staker.startTime.add(1 days) <= block.timestamp && staker startTime != 0, "No stake is active for sender address");
    _;
}
```

This modifier ensures that the caller is indeed an active staker, and is used to guard the [staker actions](#staker-actions).

Then, there are two modifiers related to the active status of the contract.

```
modifier onlyActive() {
    require(deactivationTime == 0);
    _;
}

modifier onlyInactive() {
    require(deactivationTime != 0);
    _;
}
```

These will allow or halt certain functionality based on whether or not the contract has been deactivated yet.

### Functionality

It is ensured that empty function calls and ether transfers to this contract are reverted.

```
receive() external payable {
    revert();
}
```

#### Staking

For a user to participate in the pre-staking campaign, he will have to call the `approve` method on the DUSK token contract first off, increasing the allowance for the pre-staking contract. Note that this amount needs to be at least the minimum stake or more - otherwise the `stake` function will fail.

Once approved, the user can then call the `stake` function.

```
function stake(uint256 amount) external onlyActive {
    // Ensure this staker does not exist yet.
    Staker storage staker = stakersMap[msg.sender];
    require(staker.amount == 0, "Address already known");

    if (amount > 1000000 ether || amount < 10000 ether) {
        revert("Amount to stake is out of bounds");
    }
    
    // Set information for this staker.
    uint blockTimestamp = block.timestamp;
    staker.amount = amount;
    staker.startTime = blockTimestamp;
    staker.lastUpdated = blockTimestamp;
    staker.dailyReward = amount.mul(dailyRewardPercentage.add(100000)).div(100000).sub(amount);
    stakersAmount++;
    
    // Transfer the DUSK to this contract.
    _token.safeTransferFrom(msg.sender, address(this), amount);
}
```

First off, the contract ensures this person is not already known. Then, it will check if the given `amount` is within bounds for the pre-staking contract. If this passes all checks, the sender is added to the stakers map, his information is updated, and then the tokens are transferred from the sender to the contract. The user is now officially staking.

#### Reward distribution

The reward distribution happens as follows.

```
function distributeRewards(Staker storage staker, uint comparisonTime) internal {
    uint numDays = comparisonTime.sub(staker.lastUpdated).div(1 days);
    if (numDays == 0) {
        return;
    }
    
    uint256 reward = staker.dailyReward.mul(numDays);
    staker.accumulatedReward = staker.accumulatedReward.add(reward);
    staker.lastUpdated = staker.lastUpdated.add(numDays.mul(1 days));
}
```

Note that this function can only be called internally - it is called any time a staker attempts to interact with the contract, to ensure that all statistics are updated before undertaking any further actions.

By checking the `lastUpdated` variable, the contract determines whether it is time to update the reward distribution. If this is far enough in the past, the contract calculates how many days have passed, distributing rewards on according to the amount of days, and increments the stakers `lastUpdated` variable, by adding the amount of days to it.

Finally, the reward percentage is calculated, up to a precision of three decimals. That calculated reward will then be added to the stakers `accumulatedReward` variable.

#### Staker actions

Once the stake has been accepted, and enough time has passed, the staker starts having a few options to choose from.

##### Withdrawing rewards

To withdraw the accumulated rewards, the staker should first call `startWithdrawReward`.

```
function startWithdrawReward() external onlyStaker onlyActive {
    Staker storage staker = stakersMap[msg.sender];
    uint blockTimestamp = block.timestamp;
    require(staker.cooldownTime == 0, "A withdrawal call has already been triggered");
    require(staker.endTime == 0, "Stake already withdrawn");
    distributeRewards(staker, blockTimestamp);
    
    staker.cooldownTime = blockTimestamp;
    staker.pendingReward = staker.accumulatedReward;
    staker.accumulatedReward = 0;
}
```

A number of checks are initially performed. The contract ensures the caller is actually an active staker, it makes sure no cooldown is currently running, and it ensures that the staker has not already requested to withdraw their stake. In any of these cases, the function should revert.

Then, [rewards are distributed](#reward-distribution), to ensure the right amount of DUSK is set to pending for withdrawal.

The `accumulatedReward` is then copied to the `pendingReward`, which is the amount that can be released after the cooldown ends. The `accumulatedReward` is reset to 0.

After a 7 day cooldown, the staker can call `withdrawReward`.

```
function withdrawReward() external onlyStaker {
    Staker storage staker = stakersMap[msg.sender];
    uint cooldownTime = staker.cooldownTime;
    require(cooldownTime != 0, "The withdrawal cooldown has not been triggered");

    if (block.timestamp.sub(cooldownTime) >= 7 days) {
        uint256 reward = staker.pendingReward;
        staker.cooldownTime = 0;
        staker.pendingReward = 0;
        _token.safeTransfer(msg.sender, reward);
    }
}
```

The contract checks if the caller is an active staker, and makes sure there is an actual cooldown time known. Following that, the contract checks if the cooldown period (7 days) has passed. If yes, the `cooldownTime` and `pendingReward` are then reset, and the pending tokens are released to the caller.

##### Withdrawing the stake

To withdraw the stake, and any remaining reward, the staker can call `startWithdrawStake`.

```
function startWithdrawStake() external onlyStaker onlyActive {
    Staker storage staker = stakersMap[msg.sender];
    uint blockTimestamp = block.timestamp;
    require(staker.startTime.add(30 days) <= blockTimestamp, "Stakes can only be withdrawn 30 days after initial lock up");
    require(staker.endTime == 0, "Stake withdrawal already in progress");
    require(staker.cooldownTime == 0, "A withdrawal call has been triggered - please wait for it to complete before withdrawing your stake");
    
    // We distribute the rewards first, so that the withdrawing staker
    // receives all of their allocated rewards, before setting an `endTime`.
    distributeRewards(staker, blockTimestamp);
    staker.endTime = blockTimestamp;
}
```

The contract checks if the caller is an active staker, and makes sure the 30 day initial lock-up has passed. Furthermore, it ensures that the staker has not already requested to withdraw their stake, and that they have no current cooldown going on for reward withdrawal.

[Rewards are then distributed](#reward-distribution), to make sure all statistics are completely up-to-date. The stakers `endTime` field is then populated with the current time, to signify that the cooldown period of 7 days has begun, and that the staker can no longer reap any rewards.

After a 7 day cooldown, the staker can call `withdrawStake`.

```
function withdrawStake() external onlyStaker {
    Staker storage staker = stakersMap[msg.sender];
    uint endTime = staker.endTime;
    require(endTime != 0, "Stake withdrawal call was not yet initiated");
    
    if (block.timestamp.sub(endTime) >= 7 days) {
        removeUser(staker, msg.sender);
    }
}
```

After making sure that the caller is an active staker, and has previously signaled to withdraw their stake, the cooldown period is then evaluated. If 7 days have passed, the total amount of DUSK to release is then calculated as `amount + accumulatedReward`. The stakers records are then deleted, before releasing the tokens back to the staker. He is now officially no longer staking.

The staker is removed via the `removeUser` internal function.

```
function removeUser(Staker storage staker, address sender) internal {
    uint256 balance = staker.amount.add(staker.accumulatedReward);
    delete stakersMap[sender];
    stakersAmount--;
    
    _token.safeTransfer(sender, balance);
}
```

#### Owner actions

The owner gets the option to deactivate the contract at any point.

```
function deactivate() external onlyOwner onlyActive {
    deactivationTime = block.timestamp;
}
```

As you can see, this function is guarded with the `onlyOwner` modifier.

##### Returning stakes

As a contingency, the owner can return stakes to the users by calling the `returnStake` function.

```
function returnStake(address _staker) external onlyOwner {
    Staker storage staker = stakersMap[_staker];
    require(staker.amount > 0, "This person is not staking");

    uint comparisonTime = block.timestamp;
    if (deactivationTime != 0) {
        comparisonTime = deactivationTime;
    }

    distributeRewards(staker, comparisonTime);

    // If this user has a pending reward, add it to the accumulated reward before
    // paying him out.
    staker.accumulatedReward = staker.accumulatedReward.add(staker.pendingReward);
    removeUser(staker, _staker);
}
```

Which essentially instantly returns the accumulated reward and the stake to the user with the given address. This function can be used in the incredibly unlikely case of contract failure, to secure the users assets, as well as returning users assets after the campaign has completed, in case they have forgotten to withdraw their DUSK.