var DuskToken = artifacts.require("./DuskToken.sol");
var Prestaking = artifacts.require("./PrestakingProvisioner.sol");

module.exports = function(deployer) {
  deployer.deploy(DuskToken, "Dusk Network", "DUSK").then(function() {
    let time = Math.floor(Date.now()/1000);
    return deployer.deploy(Prestaking, DuskToken.address, 250000, 250000, 20, time);
  });
};