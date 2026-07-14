/** Ethers human-readable ABI fragments for RH stacks. */

export const PHASE1_ENS_ABI = [
  "function owner(bytes32) view returns (address)",
  "function resolver(bytes32) view returns (address)",
  "function ttl(bytes32) view returns (uint64)",
  "function recordExists(bytes32) view returns (bool)",
];

export const PHASE1_BASE_ABI = [
  "function nameExpires(uint256 id) view returns (uint256)",
  "function available(uint256 id) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function ens() view returns (address)",
  "function baseNode() view returns (bytes32)",
  "function controllers(address) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

export const PHASE1_CTRL_ABI = [
  "error CommitmentTooNew()",
  "error CommitmentTooOld()",
  "error CommitmentMissing()",
  "error UnexpiredCommitmentExists()",
  "error NameNotAvailable()",
  "error DurationTooShort()",
  "error InsufficientValue()",
  "function MIN_REGISTRATION_DURATION() view returns (uint256)",
  "function minCommitmentAge() view returns (uint256)",
  "function maxCommitmentAge() view returns (uint256)",
  "function commitments(bytes32) view returns (uint256)",
  "function available(string) view returns (bool)",
  "function valid(string) view returns (bool)",
  "function rentPrice(string,uint256) view returns (tuple(uint256 base,uint256 premium))",
  "function makeCommitment(string,address,bytes32) pure returns (bytes32)",
  "function commit(bytes32)",
  "function register(string,address,uint256,bytes32,address) payable",
  "function renew(string,uint256) payable",
  "function prices() view returns (address)",
  "function base() view returns (address)",
  "function owner() view returns (address)",
  "function withdraw()",
  "event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 baseCost, uint256 premium, uint256 expires)",
  "event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)",
];

export const PHASE1_ORACLE_ABI = [
  "function price3() view returns (uint256)",
  "function price4() view returns (uint256)",
  "function price5Plus() view returns (uint256)",
  "function price(string,uint256,uint256) view returns (tuple(uint256 base,uint256 premium))",
];

export const PHASE1_RESOLVER_ABI = [
  "function addr(bytes32) view returns (address)",
  "function addr(bytes32,uint256) view returns (bytes)",
  "function name(bytes32) view returns (string)",
  "function text(bytes32,string) view returns (string)",
  "function setAddr(bytes32,address)",
  "function setAddr(bytes32,uint256,bytes)",
  "function setName(bytes32,string)",
  "function setText(bytes32,string,string)",
  "function supportsInterface(bytes4) view returns (bool)",
];

export const PHASE1_REVERSE_ABI = [
  "function defaultResolver() view returns (address)",
  "function node(address) pure returns (bytes32)",
  "function setName(string) returns (bytes32)",
  "function claim(address) returns (bytes32)",
];

export const V4_REGISTRY_ABI = [
  "error InvalidResolver()",
  "error InvalidOwner()",
  "error InvalidLabel()",
  "error NameTaken()",
  "error NotNameOwner()",
  "error NameNotFound()",
  "error NotAuthorized()",
  "error InvalidDuration()",
  "error NameExpired()",
  "function available(string) view returns (bool)",
  "function ownerOf(string) view returns (address)",
  "function resolve(string) view returns (address)",
  "function nameExpires(string) view returns (uint64)",
  "function totalNames() view returns (uint256)",
  "function namehash(string) view returns (bytes32)",
  "function owner(bytes32) view returns (address)",
  "function registrar() view returns (address)",
  "function owner() view returns (address)",
  "function MIN_REGISTRATION() view returns (uint64)",
  "function MAX_REGISTRATION() view returns (uint64)",
];

export const V4_REGISTRAR_ABI = [
  "error InvalidPrice()",
  "error InsufficientPayment(uint256 required, uint256 paid)",
  "error TransferFailed()",
  "error LabelUnavailable()",
  "error InvalidDuration()",
  "function rentPricePerYear(string) view returns (uint256)",
  "function rentPrice(string,uint64) view returns (uint256)",
  "function rentPrice(string) view returns (uint256)",
  "function quote(string,uint64) view returns (uint256)",
  "function quote(string) view returns (uint256)",
  "function price3() view returns (uint256)",
  "function price4() view returns (uint256)",
  "function price5Plus() view returns (uint256)",
  "function register(string,address,address,uint64) payable returns (address,uint64)",
  "function register(string,address,address) payable returns (address,uint64)",
  "function renew(string,uint64) payable returns (uint64)",
  "function registry() view returns (address)",
  "function owner() view returns (address)",
];
