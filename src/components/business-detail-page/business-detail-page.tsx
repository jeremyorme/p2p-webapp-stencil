import { Component, Prop, State, h } from '@stencil/core';
import { MatchResults } from '@stencil/router';
import { database } from '../../data/database';
import { Business } from '../../data/business';

@Component({
  tag: 'business-detail-page',
  styleUrl: 'business-detail-page.css',
  shadow: true,
})
export class BusinessDetailPage {
  @Prop() match: MatchResults;
  @State() business: Business;

  componentWillLoad() {
    this.business = database.getBusiness(this.match?.params?.storeId, this.match?.params?.key);
    database.onBusinessChanged(() => this.business = database.getBusiness(this.match?.params?.storeId, this.match?.params?.key));
  }

  render() {
    return (
      <div>
        <h1>{this.business?.name}</h1>
        <h2>Details</h2>
        {['Name', 'Description', 'Icon', 'Url', 'Tel', 'Address'].map(p => <p>
          {p}<input type="text" value={this.business?.[p.toLowerCase()]} onInput={e => database.setBusiness({[p.toLowerCase()]: (e.target as HTMLInputElement).value})} readonly={database.readonly}/>
        </p>)}
        {['Longitude', 'Latitude'].map(p => <p>
          {p}<input type="text" value={(this.business?.[p.toLowerCase()] || 0).toString()} onInput={e => database.setBusiness({[p.toLowerCase()]: parseFloat((e.target as HTMLInputElement).value)})} readonly={database.readonly}/>
        </p>)}
      </div>
    );
  }
}
