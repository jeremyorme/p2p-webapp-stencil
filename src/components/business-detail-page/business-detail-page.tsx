import { Component, State, h } from '@stencil/core';
import { database } from '../../data/database';

@Component({
  tag: 'business-detail-page',
  styleUrl: 'business-detail-page.css',
  shadow: true,
})
export class BusinessDetailPage {
  @State() business: string;

  componentWillLoad() {
    this.business = database.business;
    database.onBusinessChanged(() => this.business = database.business);
  }

  render() {
    return (
      <div>
        <h1>Business</h1>
        <h2>Details</h2>
        <p>
          Name<input type="text" value={this.business} onInput={e => database.setBusiness((e.target as HTMLInputElement).value)} readonly={database.readonly} />
        </p>
        <p>
          Address<input type="text" value={database.myStore.address.toString()} readonly={true} />
        </p>
      </div>
    );
  }
}
