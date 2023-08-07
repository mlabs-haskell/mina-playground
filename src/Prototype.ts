import { AccountUpdate, Bool, CircuitValue, Field, MerkleTree, MerkleWitness, Poseidon, Provable, PublicKey, SmartContract, State, Struct, UInt64, method, prop, state } from "snarkyjs";
import * as snarkyjs from "snarkyjs";

export class ProposalStatus extends Field {
  private constructor(value: number) {
    super(value);
  }

  private static mkPredefined(value: number): ProposalStatus {
    return new ProposalStatus(value);
  }

  static get DRAFT(): ProposalStatus {
    return this.mkPredefined(0);
  }
  static get VOTING_READY(): ProposalStatus {
    return this.mkPredefined(1);
  }
  static get LOCKED(): ProposalStatus {
    return this.mkPredefined(2);
  }
  static get FINISHED(): ProposalStatus {
    return this.mkPredefined(3);
  }

  static get UNDEFINED(): ProposalStatus {
    return this.mkPredefined(13);
  }
}

export class GovernanceParameters extends CircuitValue {
  @prop minDraft: UInt64
  @prop quorum: UInt64

  getHash() {
    return Poseidon.hash(
      this.minDraft.toFields()
        .concat(this.quorum.toFields()));
  }
}

const PROPOSAL_TREE_HEIGHT = 9;

const PROPOSAL_TREE_LEAF_COUNT: bigint =
  2n ** BigInt(PROPOSAL_TREE_HEIGHT - 1);

const EMPTY_PROPOSAL_TREE_LEAF: Field = Poseidon.hash([]);

const EMPTY_PROPOSAL_TREE: MerkleTree = (() => {
  const tree = new MerkleTree(PROPOSAL_TREE_HEIGHT);
  tree.fill(new Array(PROPOSAL_TREE_HEIGHT).fill(EMPTY_PROPOSAL_TREE_LEAF));
  return tree;
})();

const STAKE_TREE_HEIGHT = 11;

const STAKE_TREE_LEAF_COUNT: bigint =
  2n ** BigInt(STAKE_TREE_HEIGHT - 1);

const EMPTY_STAKE_TREE_LEAF: Field = Poseidon.hash([]);

const EMPTY_STAKE_TREE: MerkleTree = (() => {
  const tree = new MerkleTree(STAKE_TREE_HEIGHT);
  tree.fill(new Array(STAKE_TREE_HEIGHT).fill(EMPTY_STAKE_TREE_LEAF));
  return tree;
})();

export class Proposal extends Struct({
  id: Field,
  parameters: GovernanceParameters,
  status: ProposalStatus,
  effectExecutor: PublicKey,
  voteYes: UInt64,
  voteNo: UInt64,
}) {
  getHash(): Field {
    return Poseidon.hash(Proposal.toFields(this));
  }
}

export class StakeLock extends Struct({
  used: Bool,
  proposalId: Field,
  isCreator: Bool,
  votedYes: Bool
}) { }

export class Stake extends Struct({
  owner: PublicKey,
  amount: UInt64,
  lockedBy: StakeLock
}) {
  getHash(): Field {
    return Poseidon.hash(Stake.toFields(this));
  }
}

export class ProposalMerkleTreeWitness extends
  MerkleWitness(PROPOSAL_TREE_HEIGHT) {
}

export class StakeMerkleTreeWitness extends
  MerkleWitness(STAKE_TREE_HEIGHT) {
}

export class EffectExecutor extends SmartContract {
  @state(Field) x = State();

  init() {
    super.init();

    const Permissions = snarkyjs.Permissions;
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      editState: Permissions.proof(),
      receive: Permissions.proof(),
      setDelegate: Permissions.impossible(),
      setTokenSymbol: Permissions.impossible(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.impossible(),
    });
  }

  @method execute(): Bool {
    Provable.log("Hello World!");
    this.x.set(new Field(42));

    return new Bool(true);
  }
}

class VoteUpdates extends CircuitValue {
  @prop voteYes: UInt64;
  @prop voteNo: UInt64;
}

export class Governor extends SmartContract {
  @state(Field) parametersHash = State<Field>();
  @state(Field) proposalTreeRoot = State<Field>();
  @state(Field) stakeTreeRoot = State<Field>();

  constructor(
    parameters: GovernanceParameters,
    address: PublicKey,
    governanceTokenId: Field) {
    super(address, governanceTokenId);

    this.parametersHash.set(parameters.getHash())
    this.proposalTreeRoot.set(EMPTY_PROPOSAL_TREE.getRoot());
    this.stakeTreeRoot.set(EMPTY_STAKE_TREE.getRoot());
  }

  init() {
    super.init();

    const Permissions = snarkyjs.Permissions;
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      editState: Permissions.proof(),
      receive: Permissions.proof(),
      setDelegate: Permissions.impossible(),
      setTokenSymbol: Permissions.impossible(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.impossible(),
    });
  }

  @method createProposal(
    parameters: GovernanceParameters,
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness,
    proposalWitness: ProposalMerkleTreeWitness,
    effectExecutor: PublicKey
  ) {
    Poseidon.hash(GovernanceParameters.toFields(parameters))
      .assertEquals(this.parametersHash.getAndAssertEquals(),
        "bad governance parameter");

    proposalWitness
      .calculateRoot(EMPTY_PROPOSAL_TREE_LEAF)
      .assertEquals(
        this.proposalTreeRoot.getAndAssertEquals(),
        "bad proposal witness: slot occupied")

    stakeWitness
      .calculateRoot(Poseidon.hash(Stake.toFields(stake)))
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    stake.lockedBy.used.assertFalse("stake locked");
    stake.amount.assertGreaterThan(
      parameters.minDraft,
      "staked amount less than minimum");

    const proposalId = new Field(proposalWitness.calculateIndex());
    const proposal = new Proposal({
      id: proposalId,
      parameters: parameters,
      status: ProposalStatus.DRAFT,
      effectExecutor: effectExecutor,
      voteYes: new UInt64(0),
      voteNo: new UInt64(0),
    })

    const newProposalTreeRoot =
      proposalWitness.calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    stake.lockedBy.used = new Bool(true);
    stake.lockedBy.isCreator = new Bool(true);
    stake.lockedBy.proposalId = proposalId;

    const newStakeTreeRoot =
      stakeWitness.calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);
  }

  @method createStake(
    stakeWitness: StakeMerkleTreeWitness,
    owner: PublicKey,
    amount: UInt64) {
    stakeWitness
      .calculateRoot(EMPTY_STAKE_TREE_LEAF)
      .assertEquals(this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake witness: slot occupied");

    const userAccountUpdate = AccountUpdate.create(owner);
    userAccountUpdate.send({ to: this.address, amount: amount });

    const stake = new Stake({
      owner: owner,
      amount: new UInt64(amount),
      lockedBy: new StakeLock({
        used: Bool(false),
        proposalId: Field(0),
        isCreator: Bool(false),
        votedYes: Bool(false)
      })
    })

    const newStakeTreeRoot =
      stakeWitness.calculateRoot(Poseidon.hash(Stake.toFields(stake)));
    this.stakeTreeRoot.set(newStakeTreeRoot);
  }

  @method advanceProposal(
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness,
  ) {
    proposalWitness
      .calculateRoot(Poseidon.hash(Proposal.toFields(proposal)))
      .assertEquals(this.proposalTreeRoot.getAndAssertEquals()
        , "bad proposal");

    const nextStatus = Provable.if(
      proposal.status.equals(ProposalStatus.DRAFT),
      ProposalStatus.VOTING_READY,
      (
        Provable.if(
          proposal.status.equals(ProposalStatus.VOTING_READY),
          ProposalStatus.LOCKED,
          Provable.if(
            proposal.status.equals(ProposalStatus.LOCKED),
            ProposalStatus.FINISHED,
            ProposalStatus.UNDEFINED
          )
        )
      )
    );

    nextStatus.assertNotEquals(
      ProposalStatus.UNDEFINED,
      "cannot advance finished proposal");

    Provable.if(
      proposal.status.equals(ProposalStatus.VOTING_READY),
      Bool.and(
        Bool.or(
          proposal.voteNo.greaterThanOrEqual(proposal.parameters.quorum),
          proposal.voteYes.greaterThanOrEqual(proposal.parameters.quorum)
        ),
        proposal.voteNo.equals(proposal.voteYes).not()
      ),
      new Bool(true)
    ).assertTrue("cannot advance from voting ready yet");

    const executor = new EffectExecutor(proposal.effectExecutor);

    Provable.if(
      proposal.status.equals(ProposalStatus.LOCKED),
      Provable.if(
        proposal.voteYes.greaterThan(proposal.voteNo).and(
          proposal.voteYes.greaterThan(proposal.parameters.quorum)
        ),
        executor.execute(),
        new Bool(true)
      ),
      new Bool(true)
    ).assertTrue("cannot advance from locked");

    proposal.status = nextStatus;

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);
  }

  @method unlockStake(
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness,
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness
  ) {
    stakeWitness
      .calculateRoot(Poseidon.hash(Stake.toFields(stake)))
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    proposalWitness
      .calculateRoot(Poseidon.hash(Proposal.toFields(proposal)))
      .assertEquals(
        this.proposalTreeRoot.getAndAssertEquals(),
        "bad proposal");

    stake.lockedBy.used
      .and(stake.lockedBy.proposalId.equals(proposal.id))
      .assertTrue("irrelevant stake");

    AccountUpdate.create(stake.owner).requireSignature();

    Provable.if(
      stake.lockedBy.isCreator,
      proposal.status.equals(ProposalStatus.FINISHED),
      new Bool(true))
      .assertTrue("proposal not finished");

    const newVotes = Provable.if(
      stake.lockedBy.isCreator
        .or(proposal.status.equals(ProposalStatus.FINISHED)),
      new VoteUpdates({
        voteYes: proposal.voteYes,
        voteNo: proposal.voteNo
      }),
      Provable.if(
        stake.lockedBy.votedYes,
        new VoteUpdates({
          voteYes: proposal.voteYes.sub(stake.amount),
          voteNo: proposal.voteNo
        }),
        new VoteUpdates({
          voteYes: proposal.voteYes,
          voteNo: proposal.voteNo.sub(stake.amount),
        })
      ),
    )

    proposal.voteYes = newVotes.voteYes;
    proposal.voteNo = newVotes.voteNo;

    stake.lockedBy.used = new Bool(false);

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    const newStakeTreeRoot = stakeWitness
      .calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);
  }

  @method voteWithStake(
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness,
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness,
    voteYes: Bool) {
    stakeWitness
      .calculateRoot(Poseidon.hash(Stake.toFields(stake)))
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    proposalWitness
      .calculateRoot(Poseidon.hash(Proposal.toFields(proposal)))
      .assertEquals(
        this.proposalTreeRoot.getAndAssertEquals(),
        "bad proposal");

    stake.lockedBy.used.assertFalse("stake locked");

    AccountUpdate.create(stake.owner).requireSignature();

    proposal.status.assertEquals(
      ProposalStatus.VOTING_READY,
      "can only vote in voting period");

    const newVotes =
      Provable.if(
        voteYes,
        new VoteUpdates({
          voteYes: proposal.voteYes.add(stake.amount),
          voteNo: proposal.voteNo
        }),
        new VoteUpdates({
          voteYes: proposal.voteYes,
          voteNo: proposal.voteNo.add(stake.amount),
        })
      )

    proposal.voteYes = newVotes.voteYes;
    proposal.voteNo = newVotes.voteNo;

    stake.lockedBy.used = new Bool(true);
    stake.lockedBy.isCreator = new Bool(false);
    stake.lockedBy.proposalId = proposal.id;
    stake.lockedBy.votedYes = voteYes;

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    const newStakeTreeRoot = stakeWitness
      .calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);
  }

  @method destroyStake(
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness
  ) {
    stakeWitness
      .calculateRoot(Poseidon.hash(Stake.toFields(stake)))
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    stake.lockedBy.used.assertFalse("stake locked");
    AccountUpdate.create(stake.owner).requireSignature();

    this.send({ to: stake.owner, amount: stake.amount });

    const newStakeTreeRoot = stakeWitness
      .calculateRoot(EMPTY_STAKE_TREE_LEAF);
    this.stakeTreeRoot.set(newStakeTreeRoot);
  }
}
