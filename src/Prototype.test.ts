import { AccountUpdate, Bool, CircuitValue, Field, Mina, Poseidon, PrivateKey, Provable, PublicKey, Struct, UInt32, UInt64, prop } from "snarkyjs";
import { GovernanceParameters, Governor, PROPOSAL_TREE_HEIGHT, Proposal, ProposalMerkleTreeWitness, STAKE_TREE_HEIGHT, Stake, StakeMerkleTreeWitness } from "./Prototype";
import { Dummy } from "./Dummy";
import { OffchainStorage } from "./OffchainStorage";

let proofsEnabled = false;

describe('full workflow', () => {
  let deployerPrivateKey: PrivateKey;
  let deployerPublicKey: PublicKey;

  let user1PrivateKey: PrivateKey;
  let user1PublicKey: PublicKey;

  let user2PrivateKey: PrivateKey;
  let user2PublicKey: PublicKey;

  let user3PrivateKey: PrivateKey;
  let user3PublicKey: PublicKey;

  let user4PrivateKey: PrivateKey;
  let user4PublicKey: PublicKey;

  let governorPrivateKey: PrivateKey;
  let governorPublicKey: PublicKey;

  let governor: Governor;

  let stakeStorage: OffchainStorage<Stake>;
  let proposalStorage: OffchainStorage<Proposal>;

  const governanceParameters = new GovernanceParameters(
    {
      create: UInt64.from(100),
      quorum: UInt64.from(100_000)
    }
  );

  beforeAll(async () => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    deployerPrivateKey = Local.testAccounts[0].privateKey;
    deployerPublicKey = Local.testAccounts[0].publicKey;

    user1PrivateKey = Local.testAccounts[1].privateKey;
    user1PublicKey = Local.testAccounts[1].publicKey;

    user2PrivateKey = Local.testAccounts[2].privateKey;
    user2PublicKey = Local.testAccounts[2].publicKey;

    user3PrivateKey = Local.testAccounts[3].privateKey;
    user3PublicKey = Local.testAccounts[3].publicKey;

    user4PrivateKey = Local.testAccounts[4].privateKey;
    user4PublicKey = Local.testAccounts[4].publicKey;

    governorPrivateKey = PrivateKey.random();
    governorPublicKey = governorPrivateKey.toPublicKey();

    if (proofsEnabled) {
      Governor.compile();
    }

    governor = new Governor(governorPublicKey);

    stakeStorage = new OffchainStorage(STAKE_TREE_HEIGHT);
    proposalStorage = new OffchainStorage(PROPOSAL_TREE_HEIGHT);
  });

  it("deploy governor", async () => {
    const txn = await Mina.transaction(deployerPublicKey, () => {
      AccountUpdate.fundNewAccount(deployerPublicKey);
      governor.deployGovernor(governanceParameters);
    });
    await txn.prove();
    await txn.sign([deployerPrivateKey, governorPrivateKey]).send();
  });

  it("user 1: create stake", async () => {
    const index = BigInt(0);
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const amount = 100_000_000;
    let newStake: Stake
    const txn = await Mina.transaction(user1PublicKey, () => {
      newStake = governor.createStake(witness, user1PublicKey, UInt64.from(amount));
    });
    await txn.prove();
    await txn.sign([user1PrivateKey]).send();
    stakeStorage.set(index, newStake!);
  });

  it("user 2: create stake", async () => {
    const index = BigInt(1)
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const amount = 100_000_000;
    let newStake: Stake
    const txn = await Mina.transaction(user2PublicKey, () => {
      newStake = governor.createStake(witness, user2PublicKey, UInt64.from(amount));
    });
    await txn.prove();
    await txn.sign([user2PrivateKey]).send();
    stakeStorage.set(index, newStake!);
  });

  it("user 1: destroy stake", async () => {
    const index = BigInt(0)
    const stake = stakeStorage.get(index)!;
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const txn = await Mina.transaction(user1PublicKey, () => {
      governor.destroyStake(stake, witness);
    });
    await txn.prove();
    await txn.sign([user1PrivateKey]).send();
    stakeStorage.delete(index);
  });

  it("user 1: create stake again", async () => {
    const index = BigInt(0);
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const amount = 100_000_000;
    let newStake: Stake
    const txn = await Mina.transaction(user1PublicKey, () => {
      newStake = governor.createStake(witness, user1PublicKey, UInt64.from(amount));
    });
    await txn.prove();
    await txn.sign([user1PrivateKey]).send();
    stakeStorage.set(index, newStake!);
  });

  it("user 1: create a proposal", async () => {
    const stakeIndex = BigInt(0);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));
    let newProposal: Proposal
    let newStake: Stake
    const txn = await Mina.transaction(user1PublicKey, () => {
      [newStake, newProposal] = governor.createProposal(
        governanceParameters,
        stake,
        stakeWitness,
        proposalWitness);
    });
    await txn.prove();
    await txn.sign([user1PrivateKey]).send();
    stakeStorage.set(stakeIndex, newStake!)
    proposalStorage.set(proposalIndex, newProposal!);
  });

  it("user 3: create stake", async () => {
    const index = BigInt(2);
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const amount = 100_000;
    let newStake: Stake
    const txn = await Mina.transaction(user3PublicKey, () => {
      newStake = governor.createStake(witness, user3PublicKey, UInt64.from(amount));
    });
    await txn.prove();
    await txn.sign([user3PrivateKey]).send();
    stakeStorage.set(index, newStake!);
  });

  it("user 4: create stake", async () => {
    const index = BigInt(3);
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const amount = 100_000;
    let newStake: Stake
    const txn = await Mina.transaction(user4PublicKey, () => {
      newStake = governor.createStake(witness, user4PublicKey, UInt64.from(amount));
    });
    await txn.prove();
    await txn.sign([user4PrivateKey]).send();
    stakeStorage.set(index, newStake!);
  });

  it("advance proposal: Draft -> VotingReady", async () => {
    const index = BigInt(0);
    const witness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(index));
    const proposal = proposalStorage.get(index)!;

    let newProposal: Proposal

    const txn = await Mina.transaction(deployerPublicKey, () => {
      newProposal = governor.advanceProposalFromDraft(proposal, witness);
    });
    await txn.prove();
    await txn.sign([deployerPrivateKey]).send();
    proposalStorage.set(index, newProposal!);
  })

  it("user 4: vote yes", async () => {
    const stakeIndex = BigInt(3);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));
    let newProposal: Proposal
    let newStake: Stake

    const txn = await Mina.transaction(user4PublicKey, () => {
      [newStake, newProposal] = governor.vote(
        stake, stakeWitness,
        proposal, proposalWitness,
        new Bool(true));
    });
    await txn.prove();
    await txn.sign([user4PrivateKey]).send();
    proposalStorage.set(proposalIndex, newProposal!);
    stakeStorage.set(stakeIndex, newStake!);
  })

  it("user 2: vote yes", async () => {
    const stakeIndex = BigInt(1);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));
    let newProposal: Proposal
    let newStake: Stake

    const txn = await Mina.transaction(user2PublicKey, () => {
      [newStake, newProposal] = governor.vote(
        stake, stakeWitness,
        proposal, proposalWitness,
        new Bool(true));
    });
    await txn.prove();
    await txn.sign([user2PrivateKey]).send();
    proposalStorage.set(proposalIndex, newProposal!);
    stakeStorage.set(stakeIndex, newStake!);
  })

  it("user 3: vote no", async () => {
    const stakeIndex = BigInt(2);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));
    let newProposal: Proposal
    let newStake: Stake

    const txn = await Mina.transaction(user3PublicKey, () => {
      [newStake, newProposal] = governor.vote(
        stake, stakeWitness,
        proposal, proposalWitness,
        new Bool(false));
    });
    await txn.prove();
    await txn.sign([user3PrivateKey]).send();
    proposalStorage.set(proposalIndex, newProposal!);
    stakeStorage.set(stakeIndex, newStake!);
  })

  it("user 4: retract votes", async () => {
    const stakeIndex = BigInt(3);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));
    let newProposal: Proposal
    let newStake: Stake

    const txn = await Mina.transaction(user4PublicKey, () => {
      [newStake, newProposal] = governor.unlockStake(
        stake, stakeWitness,
        proposal, proposalWitness);
    });
    await txn.prove();
    await txn.sign([user4PrivateKey]).send();
    proposalStorage.set(proposalIndex, newProposal!);
    stakeStorage.set(stakeIndex, newStake!);
  })

  it("advance proposal: VotingReady -> Locked", async () => {
    const index = BigInt(0);
    const witness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(index));
    const proposal = proposalStorage.get(index)!;

    let newProposal: Proposal

    const txn = await Mina.transaction(deployerPublicKey, () => {
      newProposal = governor.advanceProposalFromVotingReady(proposal, witness);
    });
    await txn.prove();
    await txn.sign([deployerPrivateKey]).send();
    proposalStorage.set(index, newProposal!);
  })

  it("advance proposal: Locked -> Finished", async () => {
    const index = BigInt(0);
    const witness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(index));
    const proposal = proposalStorage.get(index)!;

    let shouldExecute: Bool;
    let newProposal: Proposal

    const txn = await Mina.transaction(deployerPublicKey, () => {
      [shouldExecute, newProposal] =
        governor.advanceProposalFromLocked(proposal, witness);

      Provable.asProver(() => {
        if (shouldExecute.toBoolean())
          Provable.log("effect executed")
      });
    });
    await txn.prove();
    await txn.sign([deployerPrivateKey]).send();
    proposalStorage.set(index, newProposal!);
  })

  it("user 2: unlock stake", async () => {
    const stakeIndex = BigInt(1);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));

    let newStake: Stake

    const txn = await Mina.transaction(user2PublicKey, () => {
      [newStake] =
        governor.unlockStake(stake, stakeWitness, proposal, proposalWitness);
    });
    await txn.prove();
    await txn.sign([user2PrivateKey]).send();
    stakeStorage.set(stakeIndex, newStake!);
  });

  it("user 1: unlock stake", async () => {
    const stakeIndex = BigInt(0);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(0);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));

    let newStake: Stake

    const txn = await Mina.transaction(user1PublicKey, () => {
      [newStake] =
        governor.unlockStake(stake, stakeWitness, proposal, proposalWitness);
    });
    await txn.prove();
    await txn.sign([user1PrivateKey]).send();
    stakeStorage.set(stakeIndex, newStake!);
  });

  it("user 2: destroy stake", async () => {
    const index = BigInt(1)
    const stake = stakeStorage.get(index)!;
    const witness = new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const txn = await Mina.transaction(user2PublicKey, () => {
      governor.destroyStake(stake, witness);
    });
    await txn.prove();
    await txn.sign([user2PrivateKey]).send();
    stakeStorage.delete(index);
  });
});