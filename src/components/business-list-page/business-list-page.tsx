import { Component, Host, h } from '@stencil/core';

@Component({
  tag: 'business-list-page',
  styleUrl: 'business-list-page.css',
  shadow: true,
})
export class BusinessListPage {

  render() {
    return (
      <Host>
        <slot></slot>
      </Host>
    );
  }

}
