import { Business, KeyedBusiness, OtherBusiness } from './business';
import { DbClient, Db, DbStore } from './db';

// Helper to log time elapsed since previous log
const logTime = (prev: number = 0, name: string = '') => {
  const now = performance.now();
  if (name) console.log('PERF: ' + name + ' = ' + Math.round(now - (prev ? prev : now)) + 'ms');
  return now;
};

// Returns a promise resolving after a number of seconds
const waitSeconds = (seconds: number) => {
  return new Promise((resolve, _) => {
    setTimeout(async () => {
      resolve(null);
    }, 1000 * seconds);
  });
};

class Database {
  dbClient: DbClient;
  db: Db;
  myStore: DbStore;
  business: Business;
  businessChangedListeners: any[] = [];
  readonly: boolean;
  key: string;
  publicStore: DbStore;
  businessStores: Map<string, DbStore> = new Map();
  businesses: Map<string, KeyedBusiness[]> = new Map();
  myStoreRegistered: boolean = false;
  myStoreId: string;

  onBusinessChanged(callback: any) {
    this.businessChangedListeners.push(callback);
  }

  async _notifyBusinessChanged() {
    // Get the latest value
    this.business = this.myStore.findOne({_id: this.key});

    // Notify listeners
    for (const listener of this.businessChangedListeners)
      await listener();
  }
  
  async _initMyStore() {
    // Create/open a key-value store called 'business' and load its data
    this.myStore = await this.db.collection('business');
    this.myStoreId = this.myStore.address();

    // Notify business changed following replication
    this.myStore.onUpdated(() => this._notifyBusinessChanged());

    // Determine if the user has write access
    this.readonly = !this.myStore.canWrite();
  }

  async _initBusinessStore(businessStoreId: string) {
    // If we already initialized this store then skip
    if (this.businessStores.has(businessStoreId))
      return;

    // Don't include our own store in the other businesses
    if (businessStoreId == this.myStoreId) {
      this.myStoreRegistered = true;
      return;
    }

    // Open a key-value store called 'business' with supplied id and load its data
    const businessStore = await this.db.collection('business', {address: businessStoreId});
    this.businessStores.set(businessStoreId, businessStore);
    
    // Get all businesses from the store
    this.businesses.set(businessStoreId, Array.from(businessStore.all).map(e => ({key: e[0], business: e[1] as Business})));

    // Update businesses for this store following replication
    businessStore.onUpdated(() => {
      this.businesses.set(businessStoreId, Array.from(businessStore.all).map(e => ({key: e[0], business: e[1] as Business})))
    });
  }
  
  async _initBusinessStores() {
    const businessStoreEntries = this.publicStore.all;
    await Promise.all(Array.from(businessStoreEntries).map(e => this._initBusinessStore(e[1].storeId)))
  }

  async _initPublicStore() {
    // Create/open a public log store called 'business-store' and load its data
    this.publicStore = await this.db.collection('business-store', {isPublic: true});

    // Initialize new business stores now and following replication
    await this._initBusinessStores();
    this.publicStore.onUpdated(() => this._initBusinessStores());
  }

  async _registerMyStore() {
    // Register our own store if we haven't already done so
    if (!this.myStoreRegistered)
      await this.publicStore.insertOne({storeId: this.myStoreId});
  }

  async init() {
    let t = logTime();

    // Create db client instance
    this.dbClient = new DbClient([
      '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
      '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
      '/dns4/webrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star/',
    ]);
    await this.dbClient.connect();
    t = logTime(t, 'IPFS');
    
    await waitSeconds(4);
    t = logTime(t);

    // Create db instance
    const maybeDb = await this.dbClient.db('business-directory');
    if (!maybeDb) {
      console.log('Failed to initialise database');
      return;
    }
    this.db = maybeDb;
    t = logTime(t, 'DB');
    
    // Initialize stores
    await waitSeconds(2);
    t = logTime(t);

    await this._initMyStore();
    t = logTime(t, 'My store');

    await waitSeconds(1);
    t = logTime(t);

    await this._initPublicStore();
    t = logTime(t, 'Public store');

    await waitSeconds(1);
    t = logTime(t);

    await this._registerMyStore();
    t = logTime(t, 'Register');
  }

  setBusiness(business: Partial<Business>) {
    this.business = {...this.business, ...business};
    this.myStore.insertOne({_id: this.key, ...this.business});
  }

  getBusiness(storeId: string, key: string): Business|null {
    this.key = key;
    if (this.readonly = !!storeId) {
      const maybeStore = this.businessStores.get(storeId);
      if (!maybeStore)
        return null;
      return maybeStore.findOne({_id: key});
    }
    
    this.business = this.myStore.findOne({_id: this.key});
    return this.business;
  }

  getKeyedBusinesses(): KeyedBusiness[] {
    return Array.from(this.myStore.all).map(e => ({key: e[0], business: e[1] as Business}));
  }

  getOtherBusinesses(): OtherBusiness[] {
    const otherBusinesses: OtherBusiness[] = [];
    this.businesses.forEach((kbs, id) => kbs.forEach(kb => otherBusinesses.push({id, ...kb})));
    return otherBusinesses;
  }
}

export const database = new Database();