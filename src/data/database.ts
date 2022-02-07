import { Business, KeyedBusiness, OtherBusiness } from './business';

class Database {
  ipfs: any;
  orbitdb: any;
  myStore: any;
  business: Business;
  businessChangedListeners: any[] = [];
  readonly: boolean;
  key: string;
  publicStore: any;
  businessStores: Map<string, any> = new Map();
  businesses: Map<string, KeyedBusiness[]> = new Map();
  myStoreId: string;

  onBusinessChanged(callback: any) {
    this.businessChangedListeners.push(callback);
  }

  async _notifyBusinessChanged() {
    // Get the latest value
    this.business = {...this.myStore.get(this.key)};

    // Notify listeners
    for (const listener of this.businessChangedListeners)
      await listener();
  }
  
  async _initMyStore() {
    // Create/open a key-value store called 'business' and load its data
    this.myStore = await this.orbitdb.keyvalue('/orbitdb/zdpuArKucyWfv55WCeJyEmEmFLq1Mt7UX4GTyLDMsJZNsrnQh/business');
    await this.myStore.load();
    this.myStoreId = this.myStore.address.toString().split('/')[2];

    // Get the latest value
    this.business = {...this.myStore.get('key')};

    // Notify business changed following replication
    this.myStore.events.on('replicated', () => this._notifyBusinessChanged());

    // Determine if the user has write access
    const access = new Set(this.myStore.access.write);
    this.readonly = !access.has(this.orbitdb.identity.id);
  }

  async _initBusinessStore(businessStoreId: string) {
    // If we already initialized this store then skip
    if (this.businessStores.has(businessStoreId))
      return;

    // Don't include our own store in the other businesses
    if (businessStoreId == this.myStoreId)
      return;

    // Open a key-value store called 'business' with supplied id and load its data
    const businessStore = await this.orbitdb.keyvalue('/orbitdb/' + businessStoreId + '/business');
    await businessStore.load();
    this.businessStores.set(businessStoreId, businessStore);
    
    // Get all businesses from the store
    this.businesses.set(businessStoreId, Object.entries(businessStore.all).map(e => ({key: e[0], business: e[1] as Business})));

    // Update businesses for this store following replication
    businessStore.events.on('replicated', () => this.businesses.set(businessStoreId, Object.entries(businessStore.all).map(e => ({key: e[0], business: e[1] as Business}))));
  }
  
  async _initBusinessStores() {
    const businessStoreIds = this.publicStore.iterator({limit: -1}).collect().map(e => e.payload.value);
    for (const businessStoreId of businessStoreIds)
      await this._initBusinessStore(businessStoreId);
  }

  async _initPublicStore() {
    // Create/open a public log store called 'business-store' and load its data
    this.publicStore = await this.orbitdb.log('business-store', {accessController: {write: ['*']}});
    await this.publicStore.load();

    // Initialize new business stores now and following replication
    await this._initBusinessStores();
    this.publicStore.events.on('replicated', () => this._initBusinessStores());
  }

  async _registerMyStore() {
    // If we have already registered our store then skip
    if (this.businessStores.has(this.myStoreId))
      return;

    // Add to public store and load
    await this.publicStore.add(this.myStoreId);
  }

  async init() {
    // Create IPFS instance
    this.ipfs = window['ipfs'];
    if (!this.ipfs) {
      const Ipfs = window['Ipfs'];
      this.ipfs = await Ipfs.create({
        preload: { enabled: false },
        EXPERIMENTAL: { pubsub: true },
        config: {
          Addresses: {
            Swarm: [
              '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
              '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
              '/dns4/webrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star/',
            ]
          },
        }
      });
      window['ipfs'] = this.ipfs;
    }

    // Create OrbitDB instance
    const OrbitDB = window['OrbitDB'];
    this.orbitdb = await OrbitDB.createInstance(this.ipfs);
    
    // Initialize stores
    await this._initMyStore();
    await this._initPublicStore();
    await this._registerMyStore();
  }

  setBusiness(business: Partial<Business>) {
    this.business = {...this.business, ...business};
    this.myStore.put(this.key, this.business);
  }

  getBusiness(storeId: string, key: string): Business {
    this.key = key;
    if (this.readonly = !!storeId)
      return this.businessStores.get(storeId).get(key);
    
    this.business = this.myStore.get(this.key);
    return this.business;
  }

  getKeyedBusinesses(): KeyedBusiness[] {
    return Object.entries(this.myStore.all).map(e => ({key: e[0], business: e[1] as Business}));
  }

  getOtherBusinesses(): OtherBusiness[] {
    const otherBusinesses = [];
    this.businesses.forEach((kbs, id) => kbs.forEach(kb => otherBusinesses.push({id, ...kb})));
    return otherBusinesses;
  }
}

export const database = new Database();