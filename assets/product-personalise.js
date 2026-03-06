if (!customElements.get('product-personalise')) {
  customElements.define(
    'product-personalise',
    class ProductPersonalise extends HTMLElement {
      constructor() {
        super();
      }

    }
  );
}
