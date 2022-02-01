class Database {
  ipfs: any;
  orbitdb: any;
  myStore: any;
  business: string;
  businessChangedListeners: any[] = [];
  readonly: boolean;

  onBusinessChanged(callback: any) {
    this.businessChangedListeners.push(callback);
  }

  async _notifyBusinessChanged() {
    // Get the latest value
    this.business = this.myStore.get('key');

    // Notify listeners
    for (const listener of this.businessChangedListeners)
      await listener();
  }
  
  async _initMyStore() {
    // Create/open a key-value store called 'business' and load its data
    this.myStore = await this.orbitdb.keyvalue('/orbitdb/zdpuArKucyWfv55WCeJyEmEmFLq1Mt7UX4GTyLDMsJZNsrnQh/business');
    await this.myStore.load();
    
    // Get the latest value
    this.business = this.myStore.get('key');

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

  setBusiness(business: string) {
    this.business = business;
    this.myStore.put('key', this.business);
  }
}

export const database = new Database();