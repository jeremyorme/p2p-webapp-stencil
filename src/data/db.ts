import {read, write} from 'orbit-db-io';
import IpfsPubsubPeerMonitor from 'ipfs-pubsub-peer-monitor';
import Ajv, {JTDSchemaType} from 'ajv/dist/jtd';

const ajv = new Ajv();
const Ipfs = window['Ipfs'];
const OrbitDB = window['OrbitDB'];

async function ipfsPut(ipfs: any, value: any): Promise<string> {
  return write(ipfs, 'dag-pb', value);
}

async function ipfsGet<T>(ipfs: any, cid: string): Promise<T|null> {
  try {
    return (await read(ipfs, cid, {timeout: 10000}));
  }
  catch (_) {
    return null;
  }
}

function uuidv4() {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: any) =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function mergeArrays<T>(arraysArray: T[][]): T[] {
  return [].concat.apply([], arraysArray);
}

function alphaPropSortFn(propName: string) {
  return (a, b) => +(a[propName] > b[propName]) || -(a[propName] < b[propName]);
}

const byOwnerIdentity = alphaPropSortFn('ownerIdentity');
const byClock = (a, b) => a.clock - b.clock;

interface IStoreManifest {
  name: string;
  ownerIdentity: string;
}

const storeManifestSchema: JTDSchemaType<IStoreManifest> = {
  properties: {
    name: { type: 'string' },
    ownerIdentity: { type: 'string' }
  }
};

const validateStoreManifest = ajv.compile(storeManifestSchema);

interface IObject {
  _id: string;
}

const objectSchema: JTDSchemaType<IObject> = {
  properties: {
    _id: { type: 'string' }
  },
  additionalProperties: true  
}

interface IEntry {
  value: IObject;
  clock: number;
}

const entrySchema: JTDSchemaType<IEntry> = {
  properties: {
    value: objectSchema,
    clock: { type: 'uint32' }
  }
};

interface IEntryBlock {
  entries: IEntry[];
}

const entryBlockSchema: JTDSchemaType<IEntryBlock> = {
  properties: {
    entries: { elements: entrySchema }
  }
};

const validateEntryBlock = ajv.compile(entryBlockSchema);

interface IEntryBlockList {
  ownerIdentity: string;
  entryBlockCids: string[];
  clock: number;
  publicKey: string;
  signature: string;
}

const entryBlockListSchema: JTDSchemaType<IEntryBlockList> = {
  properties: {
    ownerIdentity: { type: 'string' },
    entryBlockCids: { elements: { type: 'string' } },
    clock: { type: 'uint32' },
    publicKey: { type: 'string' },
    signature: { type: 'string' }
  }
};

interface IStore {
  senderIdentity: string;
  address: string;
  entryBlockLists: IEntryBlockList[];
  addCount: number;
}

const storeSchema: JTDSchemaType<IStore> = {
  properties: {
    senderIdentity: { type: 'string' },
    address: { type: 'string' },
    entryBlockLists: { elements: entryBlockListSchema },
    addCount: { type: 'uint32' }
  }
};

const validateStore = ajv.compile(storeSchema);

interface IStoreOptions {
  address: string;
  isPublic: boolean;
  entryBlockSize: number;
  compactThreshold: number;
}

const defaultStoreOptions: IStoreOptions = {
  address: '',
  isPublic: false,
  entryBlockSize: 16,
  compactThreshold: 128
};

export class DbClient {
  private _ipfs: any;

  constructor(private _swarmAddrs: string | string[] = '') {}

  async connect() {
    const swarmAddrs = !this._swarmAddrs ? [] :
      typeof this._swarmAddrs == 'string' ? [this._swarmAddrs] : this._swarmAddrs;
    this._ipfs = window['ipfs'];
    if (!this._ipfs) {
      this._ipfs = await Ipfs.create({
        preload: { enabled: false },
        EXPERIMENTAL: { pubsub: true },
        config: {
          Addresses: { Swarm: swarmAddrs },
        }
      });
      window['ipfs'] = this._ipfs;
    }
  }

  async close() {
    await this._ipfs.stop();
    this._ipfs = window['ipfs'] = null;
  }

  async db(name: string): Promise<Db|null> {
    if (!this._ipfs)
      return null;
    const db = new Db(this._ipfs, name);
    return db;
  }
}

export class Db {
  private _storeUpdaters: Map<string, DbStoreUpdater> = new Map();
  private _monitor: IpfsPubsubPeerMonitor = null;
  private _connected: boolean = false;
  private _identity: any = null;

  constructor(private _ipfs: any, private _name: string) {}

  async collection(name: string, options: Partial<IStoreOptions> = {}): Promise<DbStore> {

    const sub = storeJson => {
      const store: IStore = JSON.parse(storeJson.data) as IStore;
      if (store.senderIdentity == this._identity.id || !validateStore(store))
        return;
      const updater = this._storeUpdaters.get(store.address);
      if (updater)
        updater.merge(store.entryBlockLists.sort(byOwnerIdentity));
    };

    if (!this._connected) {
      const ipfsId = await this._ipfs.id();
      const store = await OrbitDB.Storage(null, {}).createStore('./orbitdb/' + ipfsId.id + '/keystore');
      const keystore = new OrbitDB.Keystore(store);
      this._identity = await OrbitDB.Identities.createIdentity({ id: ipfsId.id, keystore });

      await this._ipfs.pubsub.subscribe('/db/' + this._name, sub);
      this._monitor = new IpfsPubsubPeerMonitor(this._ipfs.pubsub, '/db/' + this._name)
      this._monitor.on('join', peer => {
        for (const storeUpdater of this._storeUpdaters.values())
          storeUpdater.onPeerJoined(peer);
      });
      this._connected = true;
    }

    const pub = (store: IStore) => {
      const storeJson = JSON.stringify(store)
      this._ipfs.pubsub.publish('/db/' + this._name, storeJson);
    };

    const storeUpdater = new DbStoreUpdater(this._ipfs, this._identity, pub, options);
    await storeUpdater.init(this._name + '/' + name);
    this._storeUpdaters.set(storeUpdater.address(), storeUpdater);

    return new DbStore(storeUpdater);
  }
}

class DbStoreUpdater {
  private _options: IStoreOptions;
  private _address: string;
  private _ownerIdentity: string;
  private _index: Map<string, any> = new Map();
  private _clock: number = 0;
  private _entryBlockLists: Map<string, IEntryBlockList> = new Map();
  private _storeCid: string;
  private _updatedCallbacks: Array<() => void> = [];
  private _addCount: number = 0;
  private _numEntries: number = 0;

  constructor(
    private _ipfs: any,
    private _identity: any,
    private _publish: (IStore) => void,
    options: Partial<IStoreOptions>) {
    this._options = {...defaultStoreOptions, ...options};
  }

  async init(name: string) {

    var manifest;
    if (this._options.address) {
      this._address = this._options.address;
      manifest = await ipfsGet<IStoreManifest>(this._ipfs, this._address);
      if (!manifest) {
        console.log('Store address ' + this._address + ' could not be reached');
        return;
      }
      if (!validateStoreManifest(manifest)) {
        console.log('Store address ' + this._address + ' refers to invalid manifest');
        return;
      }
      this._ownerIdentity = manifest.ownerIdentity;
    }
    else {
      this._ownerIdentity = this._options.isPublic ? '*' : this._identity.id;
      manifest = {name, ownerIdentity: this._ownerIdentity};
      this._address = await ipfsPut(this._ipfs, manifest);
    }

    const storeCid = window.localStorage.getItem('/db/' + this._address);
    if (storeCid) {
      const store = storeCid ? await ipfsGet<IStore>(this._ipfs, storeCid) : null;
      if (store) {
        this._addCount = store.addCount;
        await this.merge(store.entryBlockLists);
      }
    }
  }

  async merge(entryBlockLists: IEntryBlockList[]) {
    entryBlockLists.filter(entryBlockList => this._canMerge(entryBlockList)).forEach(entryBlockList => {
      this._entryBlockLists.set(entryBlockList.ownerIdentity, entryBlockList);
    });
    if (!await this._updateStoreCid())
      return;

    const entryBlockCids: string[] = mergeArrays(Array.from(this._entryBlockLists.values()).sort(byOwnerIdentity).map(ebl => ebl.entryBlockCids));
    const entryBlocks = await Promise.all(entryBlockCids.map(entryBlockCid => ipfsGet<IEntryBlock>(this._ipfs, entryBlockCid)));
    const allEntries: IEntry[] = mergeArrays(entryBlocks.map(eb => eb && validateEntryBlock(eb) ? eb.entries : []));
    this._numEntries = allEntries.length;

    allEntries.sort(byClock);
    if (allEntries.length > 0)
      this._clock = allEntries.slice(-1)[0].clock;

    this._index.clear();
    for (const entry of allEntries)
      this._index.set(entry.value._id, entry.value);
  }

  _canMerge(entryBlockList: IEntryBlockList) {
    const myEntryBlockList = this._entryBlockLists.get(entryBlockList.ownerIdentity);
    if (myEntryBlockList && entryBlockList.clock <= myEntryBlockList.clock ||
      this._ownerIdentity != '*' && this._ownerIdentity != entryBlockList.ownerIdentity ||
      !entryBlockList.signature ||
      !entryBlockList.publicKey)
      return false;

    const e = {...entryBlockList, signature: ''};
    return this._identity.provider.verify(entryBlockList.signature, entryBlockList.publicKey, JSON.stringify(e), 'v1');
  }

  async _updateStoreCid() {
    const store: IStore = {
      senderIdentity: this._identity.id,
      address: this._address,
      entryBlockLists: Array.from(this._entryBlockLists.values()),
      addCount: this._addCount }; 

    const newStoreCid = await ipfsPut(this._ipfs, store);

    if (newStoreCid == this._storeCid)
      return false;

    this._storeCid = newStoreCid;
    window.localStorage.setItem('/db/' + this._address, this._storeCid);
    this._publish(store);
    for (const cb of this._updatedCallbacks)
      cb();

    return true;
  }

  async add(objs: any[]) {
    for (const obj of objs)
      this._index.set(obj._id, obj);
    this._numEntries += objs.length;

    var myEntryBlockList: IEntryBlockList;
    const maybeMyEntryBlockList = this._entryBlockLists.get(this._identity.id);
    if (maybeMyEntryBlockList) {
      myEntryBlockList = maybeMyEntryBlockList;
    }
    else {
      myEntryBlockList = {
        ownerIdentity: this._identity.id,
        entryBlockCids: [],
        clock: 0,
        publicKey: this._identity.publicKey,
        signature: ''
      };
      this._entryBlockLists.set(this._identity.id, myEntryBlockList);
    }

    var lastBlock: IEntryBlock = {entries: []};
    if (myEntryBlockList.entryBlockCids.length > 0) {
      const maybeLastBlock = await ipfsGet<IEntryBlock>(this._ipfs, myEntryBlockList.entryBlockCids.slice(-1)[0]);
      if (!maybeLastBlock)
        return;
      lastBlock = maybeLastBlock;
    }

    const lastEntries = lastBlock.entries.length != this._options.entryBlockSize ? lastBlock.entries : [];
    let newBlockEntries = [...lastEntries, ...objs.map(obj => ({value: obj, clock: ++this._clock}))];

    const newBlocks: IEntryBlock[] = [];
    while (newBlockEntries.length > 0) {
      newBlocks.push({entries: newBlockEntries.slice(0, this._options.entryBlockSize)});
      newBlockEntries = newBlockEntries.slice(this._options.entryBlockSize);
    }

    const newBlockCids = await Promise.all(newBlocks.map(eb => ipfsPut(this._ipfs, eb)));
    const oldBlockCids = lastEntries.length > 0 ?
      myEntryBlockList.entryBlockCids.slice(0, myEntryBlockList.entryBlockCids.length - 1) :
      myEntryBlockList.entryBlockCids;

    myEntryBlockList.entryBlockCids = [...oldBlockCids, ...newBlockCids];

    this._addCount += objs.length;
    if (this._addCount >= this._options.compactThreshold) {
      this._addCount %= this._options.compactThreshold;
      await this._compact(myEntryBlockList);
    }

    myEntryBlockList.clock = this._clock;
    myEntryBlockList.signature = '';
    myEntryBlockList.signature = await this._identity.provider.sign(this._identity, JSON.stringify(myEntryBlockList));

    await this._updateStoreCid();
  }

  async _compact(myEntryBlockList: IEntryBlockList) {
    let myEntryBlocks = await Promise.all(myEntryBlockList.entryBlockCids.map(entryBlockCid => ipfsGet<IEntryBlock>(this._ipfs, entryBlockCid)));
    const myEntries: IEntry[] = mergeArrays(myEntryBlocks.map(eb => eb ? eb.entries : []));

    const myEffectiveEntryMap: Map<string, IEntry> = new Map();
    for (const entry of myEntries)
      myEffectiveEntryMap.set(entry.value._id, entry);
    const myEffectiveEntries = Array.from(myEffectiveEntryMap.values());
    this._numEntries += myEffectiveEntries.length - myEntries.length;

    myEntryBlocks = [];
    let sortedEntries = myEffectiveEntries.sort(byClock);
    while (sortedEntries.length > 0) {
      myEntryBlocks.push({entries: sortedEntries.slice(0, this._options.entryBlockSize)});
      sortedEntries = sortedEntries.slice(this._options.entryBlockSize);
    }

    myEntryBlockList.entryBlockCids = await Promise.all(myEntryBlocks.map(eb => ipfsPut(this._ipfs, eb)));
  }

  async onPeerJoined(_peer: string) {
    if (this._entryBlockLists.size > 0)
      this._publish({
        senderIdentity: this._identity.id,
        address: this._address,
        entryBlockLists: Array.from(this._entryBlockLists.values()),
        addCount: this._addCount
      });
  };

  onUpdated(callback: () => void) { this._updatedCallbacks.push(callback); }
  
  canWrite(): boolean { return this._identity == this._ownerIdentity || this._ownerIdentity == '*'; }

  address(): string { return this._address; }

  index(): Map<string, any> { return this._index; }

  numEntries(): number { return this._numEntries; }
}

export class DbStore {
  constructor(private _updater: DbStoreUpdater) {}

  async insertOne(doc: any) {
    const docWithId = doc._id ? doc : {...doc, _id: uuidv4()};
    await this._updater.add([docWithId]);
    return docWithId._id;
  }

  async insertMany(docs: any[]) {
    const docsWithId = docs.map(doc => doc._id ? doc : {...doc, _id: uuidv4()});
    await this._updater.add(docsWithId);
    return docsWithId.map(doc => doc._id);
  }

  findOne(query: any) {
    return query._id && Object.keys(query).length == 1 ? this._updater.index().get(query._id) : null;
  }

  public get all() { return this._updater.index().entries(); }

  onUpdated(callback: () => void) { this._updater.onUpdated(callback); }

  canWrite() { return this._updater.canWrite(); }

  address() { return this._updater.address(); }

  numEntries(): number { return this._updater.numEntries(); }
}