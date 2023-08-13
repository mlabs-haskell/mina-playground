import { Bool, Mina, PrivateKey, PublicKey, UInt64 } from "snarkyjs";
import { command, run, number, option, flag, subcommands } from 'cmd-ts';
import fs from 'fs/promises';
import { jsonToProposalStorage, jsonToStakeStorage, proposalStorageToJson, stakeStorageToJson } from "./Utils";
import { GovernanceParameters, Governor, Proposal, ProposalMerkleTreeWitness, ProposalStatus, Stake, StakeMerkleTreeWitness } from "./Prototype";
import { FeePayerSpec } from "snarkyjs/dist/node/lib/mina";

type Config = {
  networkUrl: string,
  fee: string,
  governorPublicKey: string,
  stakeStoragePath: string,
  proposalStoragePath: string,
  userKeyPath: string
};

const config: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));

const Network = Mina.Network(config.networkUrl);
Mina.setActiveInstance(Network);
await Governor.compile();

const userKeyBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(config.userKeyPath, 'utf8'));
const userPrivateKey = PrivateKey.fromBase58(userKeyBase58.privateKey);
const userPublicKey = PublicKey.fromBase58(userKeyBase58.publicKey);

const stakeStorage =
  jsonToStakeStorage(await fs.readFile(config.stakeStoragePath, 'utf8'));

const proposalStorage =
  jsonToProposalStorage(await fs.readFile(config.proposalStoragePath, 'utf8'));

const governor = new Governor(PublicKey.fromBase58(config.governorPublicKey));

function bigIntMax(values: Array<bigint>): bigint {
  return values.reduce((m, e) => e > m ? e : m);
}

const governanceParameters = new GovernanceParameters(
  {
    create: UInt64.from(100),
    quorum: UInt64.from(100_000)
  }
);

const feePayerSpec: FeePayerSpec = {
  sender: userPublicKey,
  fee: Number(config.fee) * 1e9
};

const createStake = command({
  name: 'create-stake',
  args: {
    amount: option({
      long: 'amount',
      type: number,
    }),
  },
  handler: async (args) => {
    let nextStakeIndex = bigIntMax(Array.from(stakeStorage.keys())) + BigInt(1);
    const witness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(nextStakeIndex));
    const amount = 100_000_000;
    let newStake: Stake
    const txn = await Mina.transaction(feePayerSpec, () => {
      newStake = governor.createStake(witness, userPublicKey, UInt64.from(amount));
    });
    await txn.prove();
    await txn.sign([userPrivateKey]).send();
    stakeStorage.set(nextStakeIndex, newStake!);
  },
});

const destroyStake = command({
  name: 'destroy-stake',
  args: {
    index: option({
      long: 'stake-index',
      type: number,
    }),
  },
  handler: async (args) => {
    const index = BigInt(args.index);
    const witness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(index));
    const stake = stakeStorage.get(index);
    let newStake: Stake
    const txn = await Mina.transaction(feePayerSpec, () => {
      governor.destroyStake(stake!, witness);
    });
    await txn.prove();
    await txn.sign([userPrivateKey]).send();
    stakeStorage.delete(index);
  },
});

const createProposal = command({
  name: 'create-proposal',
  args: {
    stakeIndex: option({
      long: 'stake-index',
      type: number,
    }),
  },
  handler: async (args) => {
    const stakeIndex = BigInt(args.stakeIndex);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = bigIntMax(Array.from(proposalStorage.keys())) + BigInt(1);
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));
    let newProposal: Proposal
    let newStake: Stake
    const txn = await Mina.transaction(feePayerSpec, () => {
      [newStake, newProposal] = governor.createProposal(
        governanceParameters,
        stake,
        stakeWitness,
        proposalWitness);
    });
    await txn.prove();
    await txn.sign([userPrivateKey]).send();
    stakeStorage.set(stakeIndex, newStake!)
    proposalStorage.set(proposalIndex, newProposal!);
  },
});

const advanceProposal = command({
  name: 'advance-proposal',
  args: {
    proposalIndex: option({
      long: 'proposal-index',
      type: number,
    }),
  },
  handler: async (args) => {
    const index = BigInt(args.proposalIndex);
    const witness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(index));
    const proposal = proposalStorage.get(index)!;

    let newProposal: Proposal
    let txn: Mina.Transaction

    if (proposal.status.equals(ProposalStatus.DRAFT).toBoolean()) {
      txn = await Mina.transaction(feePayerSpec, () => {
        newProposal = governor.advanceProposalFromDraft(proposal, witness)
      });
    } else if (proposal.status.equals(ProposalStatus.VOTING_READY).toBoolean()) {
      txn = await Mina.transaction(feePayerSpec, () => {
        newProposal = governor.advanceProposalFromVotingReady(proposal, witness)
      });
    } else if (proposal.status.equals(ProposalStatus.LOCKED).toBoolean()) {
      let shouldExecute: Bool
      txn = await Mina.transaction(feePayerSpec, () => {
        [shouldExecute, newProposal] = governor.advanceProposalFromLocked(proposal, witness)
      });
      if (shouldExecute!.toBoolean()) {
        console.log("effect executed!");
      } else {
        console.log("skip effect execution.");
      }
    } else {
      console.error("unable to advance finished proposal");
      process.exit(-1);
    }

    await txn!.prove();
    await txn!.sign([userPrivateKey]).send();

    proposalStorage.set(index, newProposal!);
  },
});

const unlockStake = command({
  name: 'unlock-stake',
  args: {
    proposalIndex: option({
      long: 'proposal-index',
      type: number,
    }),
    stakeIndex: option({
      long: 'stake-index',
      type: number,
    }),
  },
  handler: async (args) => {
    const stakeIndex = BigInt(args.stakeIndex);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(args.proposalIndex);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));

    let newStake: Stake
    let newProposal: Proposal

    const txn = await Mina.transaction(feePayerSpec, () => {
      [newStake, newProposal] =
        governor.unlockStake(stake, stakeWitness, proposal, proposalWitness);
    });
    await txn.prove();
    await txn.sign([userPrivateKey]).send();
    stakeStorage.set(stakeIndex, newStake!);
    proposalStorage.set(proposalIndex, newProposal!);
  },
})

const voteWithStake = command({
  name: 'vote',
  args: {
    proposalIndex: option({
      long: 'proposal-index',
      type: number,
    }),
    stakeIndex: option({
      long: 'stake-index',
      type: number,
    }),
    voteNo: flag({
      long: 'vote-no'
    })
  },
  handler: async (args) => {
    const stakeIndex = BigInt(args.stakeIndex);
    const stake = stakeStorage.get(stakeIndex)!;
    const stakeWitness =
      new StakeMerkleTreeWitness(stakeStorage.getWitness(stakeIndex));
    const proposalIndex = BigInt(args.proposalIndex);
    const proposal = proposalStorage.get(proposalIndex)!;
    const proposalWitness =
      new ProposalMerkleTreeWitness(proposalStorage.getWitness(proposalIndex));

    let newStake: Stake
    let newProposal: Proposal
    const txn = await Mina.transaction(feePayerSpec, () => {
      [newStake, newProposal] =
        governor.vote(stake, stakeWitness, proposal, proposalWitness,
          Bool(!args.voteNo));
    });
    await txn.prove();
    await txn.sign([userPrivateKey]).send();
    stakeStorage.set(stakeIndex, newStake!);
    proposalStorage.set(proposalIndex, newProposal!);
  },
})

const listStakes = command({
  name: 'listStakes',
  args: {
    all: flag({
      long: "all"
    })
  },
  handler: async (args) => {
    console.log(Array.from(stakeStorage.entries())
      .filter(([_, stake]): boolean =>
        args.all ||
        stake.owner.equals(userPublicKey).toBoolean()));
  }
});

const listProposals = command({
  name: 'listProposals',
  args: {
    all: flag({
      long: "all"
    })
  },
  handler: async (args) => {
    console.log(Array.from(proposalStorage.entries())
      .filter(([_, proposal]): boolean =>
        args.all ||
        proposal.status.equals(ProposalStatus.FINISHED).not().toBoolean()));
  }
});

const cmd = subcommands({
  name: "zkagora",
  cmds: {
    createStake,
    unlockStake,
    destroyStake,
    createProposal,
    advanceProposal,
    voteWithStake,
    listStakes,
    listProposals
  }
});

await run(cmd, process.argv.slice(2));

await fs.writeFile(config.stakeStoragePath, stakeStorageToJson(stakeStorage));
await fs.writeFile(config.proposalStoragePath, proposalStorageToJson(proposalStorage));