# zkAgora: [Agora](https://github.com/Liqwid-Labs/agora) on Mina

## How to build

```sh
nix build .#default
```

## How to run tests

```sh
nix build .#checks.x86_64-linux.default
```

## Demo

You'll need to clone the repo and have nix installed on your computer. We use nix for packaging the project, handling some nodejs stuff, and most importantly, providing a dev shell with all the command line tools available in the `PATH`.

```
nix develop .#demo --command zsh
```

Wait for a while and you should be dropped into a dev shell. Here are the demo tools it provides:

```shell
which genkey # Generate a wallet key pair
which deploy # For deploying a governance instance
which cli # For interacting with an governance instance
```

First of all, create some mock identities:

```shell
mkdir -p demo/identities/{deployer,user1,user2}
genkey --fund-accounts demo/identities/{deployer,user1,user2}/key.json
```

Then create a shared configuration file `demo/config.json` with the following contents:

```json
{
  "networkUrl": "https://proxy.berkeley.minaexplorer.com/graphql",
  "fee": 0.1,
  "governorPublicKey": "",
  "stakeStoragePath": "../../stakes.json",
  "proposalStoragePath": "../../proposals.json",
  "userKeyPath": "./key.json"
}
```

Then link the configuration to appropriate locations:

```shell
echo demo/identities/{deployer,user1,user2}/config.json | xargs -n 1 ln -s demo/identities/config.json
```

Now that we have finished preparing the environment, let jump right into the demo.

First, we deploy the governor.

```shell
cd demo/identities/deloyer
deploy
```

The next thing we wanna do is to create a stake. Stakes are used for creating proposals, and voting on proposals. Let's switch our identity to user1:

```
cd ../user1
```

And then, we create a stake:

```shell
cli createStake --amount 4242
```

We staked 4242 minas, which will be locked at the governor, until the stake is destroyed.

There's a handy command for inspecting stakes:

```shell
cli listStaks
```

Let's create another stake, this time with 1000 minas.

```shell
cli createStake --amount 2000
cli listStakes
```

Alright, now that we have two stakes, we can create a proposal with one of them, and vote on it with another.

```shell
cli createProposal --stake-index 1
cli listProposals
```

Look at the `status` field; it's set to 0, which corresponds to the Draft state in our code. Draft is the first state of the proposal state machine, you can read more about it in the agora spec.

Another thing worth mentioning is that our first staked is now locked by the proposal:

```
cli listStakes
```

The `used` field is set to true, indicating that the stake is locked. A locked stake cannot be used for voting or creating a proposal, until it's unlocked; we'll cover later. Cardano's agora allows multiple stake locks, but it's a bit difficult to archive on mina since it's almost impossible to encode a non-fixed-sized structure in snakyjs circuit, but I believe we'll figure it out eventually.

Next, we advance the proposal to its second state: Voting Ready. In the voting period, DAO members can freely cast votes for the options as they please.

```shell
cli advanceProposal --proposal-index 1
cli listProposals
```

Now we vote for the YES option with our second stake:

```shell
cli voteWithStake --proposal-index 1 --stake-index 2
cli listStakes
cli listProposals
```

Our second stake is locked, and our votes are correctly added to the yes option of the proposal.

Let's switch our identity again to user2, we'll create a stake and vote for the No option.

```shell
cd ../user2
cli createStake --amount 100
cli voteWithStake --proposal-index 1 --stake-index 3
cli listStakes
cli listProposals
```

There are 100 votes on the No option, sweet.

But now our user2 feels that they made a mistake and want to retract the votes, is it possible? The answer is yes!

```shell
cli unlockStake --proposal-index 1 --stake-index 3
cli listStakes
cli listProposals
```

The votes have been retracted, and the stake lock has been removed, our user2 is happy again.

Since the stake is now unlocked, it's a good opportunity to showcase another feature, destroying a stake. As mentioned, destroying a stake will returns all the funds locked in that stake to the stake owner:

```shell
cli destroyStake --stake-index 3
cli listStakes
```

Next, let's go back to our proposal and advance it to the Locked state:

```shell
cli advanceProposal --proposal-index 1
cli listProposal
```

And then advance it again to the Finished state:

```shell
cli advanceProposal --proposal-index 1
cli listProposal
```

In the transition from Locked to Finished, the effect will be executed, if yes got more votes than no, and of course exceeded a certain minimum threshold. An effect can be moving some funds from the treasury, mutating the governance parameters, etc. As you can see on the screen, the effect is executed.

Well, unfortunately, this effect is just a dummy which outputs message: we still need to find a way to establish one to one trust among smart contracts.

The finished state marks the end of a proposal. At this point, all the stakes, no matter what action was performed on the proposal, can be unlocked.

```shell
cd ../user1
cli unlockStake --proposal-index 1 --stake-index 1
cli unlockStake --proposal-index 1 --stake-index 2
cli listStakes
```

And one more thing, if we take a look at the proposal

```shell
cli listProposals --all
```

The votes are unchanged. In fact, votes cannot be changed after the voting period.

## License

[Apache-2.0](LICENSE)
