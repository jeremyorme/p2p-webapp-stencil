import { Business, KeyedBusiness } from './business';

class Database {
  ipfs: any;
  orbitdb: any;
  myStore: any;
  business: Business;
  businessChangedListeners: any[] = [];
  readonly: boolean;
  key: string;

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
    this.myStore = await this.orbitdb.keyvalue('business');
    await this.myStore.load();
    
    // Get the latest value
    this.business = {...this.myStore.get('key')};

    // Notify business changed following replication
    this.myStore.events.on('replicated', () => this._notifyBusinessChanged());

    // Determine if the user has write access
    const access = new Set(this.myStore.access.write);
    this.readonly = !access.has(this.orbitdb.identity.id);
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
  }

  setBusiness(business: Partial<Business>) {
    this.business = {...this.business, ...business};
    this.myStore.put(this.key, this.business);
  }

  getBusiness(key: string): Business {
    this.key = key;
    this.business = this.myStore.get(this.key);
    return this.business;
  }

  getKeyedBusinesses(): KeyedBusiness[] {
    return Object.entries(this.myStore.all).map(e => ({key: e[0], business: e[1] as Business}));
  }
}

export const database = new Database();