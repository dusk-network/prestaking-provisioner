// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title The DUSK Prestaking Contract.
 * @author Jules de Smit
 * @notice This contract will facilitate staking for the DUSK ERC-20 token.
 */
contract Prestaking is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    
    // The DUSK contract.
    IERC20 private _token;
    
    // Holds all of the information for a staking individual.
    struct Staker {
        uint    startTime;
        uint    endTime;
        uint256 amount;
        uint256 accumulatedReward;
        bool    active;
        uint    cooldownTime;
        uint256 pendingReward;
    }
    
    mapping(address => Staker) public stakersMap;
    address[] public allStakers;
    uint256 public minimumStake;
    uint256 public maximumStake;
    uint256 public dailyReward;
    uint256 public stakingPool;
    
    uint private lastUpdated;
    
    modifier onlyStaker() {
        Staker storage staker = stakersMap[msg.sender];
        require(staker.active);
        _;
    }
    
    constructor(IERC20 token, uint256 min, uint256 max) public {
        _token = token;
        minimumStake = min;
        maximumStake = max;
        lastUpdated = block.timestamp;
    }
    
    /**
     * @notice Ensure nobody can call this contract without calldata.
     */
    fallback() external payable {
        revert();
    }
    
    /**
     * @notice Ensure nobody can send Ether to this contract, as it is not supposed to have any.
     */
    receive() external payable {
        revert();
    }
    
    /**
     * @notice Update the minimum stake amount.
     * Can only be called by the contract owner.
     * 
     * @param amount The amount to set the minimum stake to.
     */
    function updateMinimumStake(uint256 amount) external onlyOwner {
        minimumStake = amount;
    }
    
    /**
     * @notice Update the maximum stake amount.
     * Can only be called by the contract owner.
     * 
     * @param amount The amount to set the maximum stake to.
     */
    function updateMaximumStake(uint256 amount) external onlyOwner {
        maximumStake = amount;
    }
    
    /**
     * @notice Lock up a given amount of DUSK in the pre-staking contract.
     * @dev A user is required to approve the amount of DUSK prior to calling this function.
     */
    function stake() external {
        // Ensure this staker does not exist yet.
        Staker storage staker = stakersMap[msg.sender];
        require(staker.startTime == 0);
        require(staker.endTime == 0);
        require(staker.amount == 0);
        
        // Check that the staker has approved the appropriate amount of DUSK to this contract.
        uint256 balance = _token.allowance(msg.sender, address(this));
        require(balance != 0);
        require(balance >= minimumStake);
        require(balance <= maximumStake);
        
        // Set information for this staker.
        allStakers.push(msg.sender);
        staker.amount = balance;
        staker.startTime = block.timestamp;
        
        // Transfer the DUSK to this contract.
        _token.safeTransferFrom(msg.sender, address(this), balance);
    }
    
    /**
     * @notice Start the cooldown period for withdrawing a reward.
     */
    function startWithdrawReward() external onlyStaker {
        Staker storage staker = stakersMap[msg.sender];
        require(staker.cooldownTime == 0);
        require(staker.endTime == 0);
        distributeRewards();
        
        staker.cooldownTime = block.timestamp;
        staker.pendingReward = staker.accumulatedReward;
    }
    
    /**
     * @notice Withdraw the reward. Will only work after the cooldown period has ended.
     */
    function withdrawReward() external onlyStaker {
        Staker storage staker = stakersMap[msg.sender];
        require(staker.cooldownTime != 0);
        distributeRewards();

        if (block.timestamp - staker.cooldownTime >= 7 days) {
            uint256 reward = staker.pendingReward;
            staker.cooldownTime = 0;
            staker.pendingReward = 0;
            _token.safeTransfer(msg.sender, reward);
        }
    }
    
    /**
     * @notice Start the cooldown period for withdrawing the stake.
     */
    function startWithdrawStake() external onlyStaker {
        Staker storage staker = stakersMap[msg.sender];
        require(staker.endTime == 0);
        
        // We distribute the rewards first, so that the withdrawing staker
        // receives all of their allocated rewards, before setting an `endTime`.
        distributeRewards();
        staker.endTime = block.timestamp;
        stakingPool -= staker.amount;
    }
    
    /**
     * @notice Withdraw the stake, and clear the entry of the caller.
     */
    function withdrawStake() external onlyStaker {
        Staker storage staker = stakersMap[msg.sender];
        require(staker.endTime != 0);
        distributeRewards();
        
        if (block.timestamp - staker.endTime >= 7 days) {
            uint256 balance = staker.amount.add(staker.accumulatedReward);
            delete stakersMap[msg.sender];
            
            // Delete staker from the array.
            for (uint i = 0; i < allStakers.length; i++) {
                if (allStakers[i] == msg.sender) {
                    allStakers[i] = allStakers[allStakers.length-1];
                    delete allStakers[allStakers.length-1];
                }
            }

            _token.safeTransfer(msg.sender, balance);
        }
    }
    
    /**
     * @notice Update the reward allocation, step-by-step.
     * @dev This function can update the staker's active status, and the staking pool size.
     */
    function distributeRewards() internal {
        while ((block.timestamp - lastUpdated) > 1 days) {
            lastUpdated += 1 days;
            
            // Allocate rewards for this day.
            for (uint i = 0; i < allStakers.length; i++) {
                Staker storage staker = stakersMap[allStakers[i]];
                
                // Stakers can only start receiving rewards after 30 days of lockup.
                if (lastUpdated - staker.startTime < 30 days) {
                    continue;
                }
                
                // If the staker has called to withdraw their stake, don't allocate any more rewards to them.
                if (staker.endTime != 0) {
                    continue;
                }
                
                // If this staker has just become active, update the staking pool size.
                if (!staker.active) {
                    staker.active = true;
                    stakingPool += staker.amount;
                }
                
                // Calculate percentage of reward to be received, and allocate it.
                uint256 reward = staker.amount.div(stakingPool).mul(dailyReward);
                staker.accumulatedReward += reward;
            }
        }
    }
}