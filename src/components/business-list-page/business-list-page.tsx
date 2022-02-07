import { Component, State, h } from '@stencil/core';
import { database } from '../../data/database';

@Component({
  tag: 'business-list-page',
  styleUrl: 'business-list-page.css',
  shadow: true,
})
export class BusinessListPage {
  @State() newBusinessKey: string = 'business-key';

  render() {
    return (
      <div>
        <h1>Businesses</h1>
        <h2>My businesses</h2>
        <ul>
          {database.getKeyedBusinesses().map(kb => <li><a href={'./my-business/' + kb.key +'/'}>{kb.business.name}</a></li>)}
        </ul>
        <p>
          <input value={this.newBusinessKey} onInput={e => this.newBusinessKey = (e.target as HTMLInputElement).value}/>
          <a href={'./my-business/' + this.newBusinessKey + '/'}>New</a>
        </p>

        <h2>Other businesses</h2>
        <ul>
          {database.getOtherBusinesses().map(ob => <li><a href={'./business/' + ob.id + '/' + ob.key + '/'}>{ob.business.name}</a></li>)}
        </ul>
      </div>
    );
  }
}
