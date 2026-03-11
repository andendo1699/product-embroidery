const normalizePropertyName = (name = '') => {
  const match = name.replace(/^properties\[(.+)\]$/, '$1');
  return match ? match : name;
};

if (!customElements.get('product-personalise')) {
  customElements.define(
    'product-personalise',
    class ProductPersonalise extends HTMLElement {
      constructor() {
        super();
        this.checkbox = this.querySelector('[data-personalise-toggle]');
        this.optionsWrapper = this.querySelector('[data-personalise-options]');
        this.personaliseVariantId = this.dataset.personaliseVariantId;

        // Preview elements
        this.previewMedia = this.querySelector('[data-preview-media]');
        this.previewImage = this.querySelector('[data-preview-image]');
        this.previewOverlay = this.querySelector('[data-preview-overlay]');
        this.previewText = this.querySelector('[data-preview-text]');
      }

      connectedCallback() {
        this.checkbox.addEventListener('change', this.onToggle.bind(this));
        this.initPreviewListeners();
        this.listenForVariantChange();
        this.interceptProductForm();
      }

      disconnectedCallback() {
        this.variantChangeUnsubscriber?.();
      }

      onToggle() {
        const isChecked = this.checkbox.checked;
        this.optionsWrapper.classList.toggle('!hidden', !isChecked);

        if (!isChecked) {
          this.optionsWrapper.querySelectorAll('input[type="text"]').forEach((input) => {
            input.value = '';
          });
          this.optionsWrapper.querySelectorAll('input[type="radio"]:checked').forEach((input) => {
            input.checked = false;
          });
          this.updatePreview();
        }
      }

      // --- Preview logic ---

      initPreviewListeners() {
        if (!this.previewText) return;

        // Listen for text input changes
        this.optionsWrapper.querySelectorAll('input[type="text"]').forEach((input) => {
          input.addEventListener('input', () => this.updatePreview());
        });

        // Listen for color radio changes
        this.optionsWrapper.querySelectorAll('input[type="radio"]').forEach((input) => {
          input.addEventListener('change', () => this.updatePreview());
        });
      }

      updatePreview() {
        if (!this.previewText) return;

        // Get text value
        const textInput = this.optionsWrapper.querySelector('input[type="text"]');
        const text = textInput?.value?.trim() || '';
        this.previewText.textContent = text;

        // Get selected color
        const colorRadio = this.optionsWrapper.querySelector('fieldset input[type="radio"][name*="olor"]:checked')
          || this.optionsWrapper.querySelector('fieldset input[type="radio"][name*="olour"]:checked');
        if (colorRadio) {
          this.previewText.style.color = colorRadio.value;
        } else {
          this.previewText.style.color = '#ffffff';
        }

        // Get selected font
        const fontRadio = this.optionsWrapper.querySelector('fieldset input[type="radio"][name*="ont"]:checked');
        if (fontRadio) {
          this.previewText.style.fontFamily = fontRadio.value;
        } else {
          this.previewText.style.fontFamily = '';
        }
      }

      listenForVariantChange() {
        this.variantChangeUnsubscriber = subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => {
          const variant = data.variant;
          if (!variant?.featured_media?.preview_image || !this.previewImage) return;

          const newSrc = variant.featured_media.preview_image.src;
          // Use Shopify CDN size parameter
          this.previewImage.src = newSrc.replace(/(\.\w+)(\?|$)/, '_600x$1$2');
          this.previewImage.alt = variant.featured_media.alt || variant.title || '';
        });
      }

      getProperties() {
        const properties = {};
        this.optionsWrapper.querySelectorAll('input[type="text"]').forEach((input) => {
          if (input.value.trim()) {
            const key = normalizePropertyName(input.name);
            properties[key] = input.value;

          }
        });
        this.optionsWrapper.querySelectorAll('input[type="radio"]:checked').forEach((input) => {
          const key = normalizePropertyName(input.name);
          properties[key] = input.value;
        });
        return properties;
      }

      get isActive() {
        return this.checkbox.checked;
      }

      /**
       * Intercept the parent product-form's submit to add the embroidery variant
       * alongside the main product in a single /cart/add.js call.
       */
      interceptProductForm() {
        const productFormEl = this.closest('product-info')?.querySelector('product-form')
          || document.querySelector('product-form');
        if (!productFormEl || !productFormEl.form) return;

        const form = productFormEl.form;

        // Intercept the form submit at the capture phase so we run before the original handler
        form.addEventListener('submit', (evt) => {
          // If personalisation is not active, let the original product-form handler run
          if (!this.isActive) return;

          // Stop the original product-form handler from running
          evt.preventDefault();
          evt.stopImmediatePropagation();

          const pf = productFormEl;
          if (pf.submitButton.getAttribute('aria-disabled') === 'true') return;
          pf.handleErrorMessage();
          pf.submitButton.setAttribute('aria-disabled', true);
          pf.submitButton.classList.add('loading');
          pf.querySelector('.loading__spinner').classList.remove('hidden');

          const cart = pf.cart;
          const formData = new FormData(form);
          const mainVariantId = formData.get('id');
          const quantity = parseInt(formData.get('quantity'), 10) || 1;

          const personalisationProps = this.getProperties();

          const groupId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
          const items = [
            {
              id: parseInt(mainVariantId, 10),
              quantity: quantity,
              properties: { ...personalisationProps, _personalise_group: groupId },
            },
            {
              id: parseInt(this.personaliseVariantId, 10),
              quantity: quantity,
              properties: { _personalise_group: groupId },
            },
          ];

          const sectionsToFetch = cart
            ? cart.getSectionsToRender().map((s) => s.id)
            : [];

          const body = { items };
          if (sectionsToFetch.length) {
            body.sections = sectionsToFetch;
            body.sections_url = window.location.pathname;
          }

          if (cart) cart.setActiveElement(document.activeElement);

          fetch(window.Shopify.routes.root + 'cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          })
            .then((r) => r.json())
            .then((response) => {
              if (response.status) {
                publish(PUB_SUB_EVENTS.cartError, {
                  source: 'product-form',
                  productVariantId: mainVariantId,
                  errors: response.errors || response.description,
                  message: response.message,
                });
                pf.handleErrorMessage(response.description);
                pf.error = true;
                return;
              }

              if (!cart) {
                window.location = window.routes.cart_url;
                return;
              }

              if (!pf.error) {
                publish(PUB_SUB_EVENTS.cartUpdate, {
                  source: 'product-form',
                  productVariantId: mainVariantId,
                  cartData: response,
                });
              }
              pf.error = false;

              const quickAddModal = pf.closest('quick-add-modal');
              if (quickAddModal) {
                document.body.addEventListener(
                  'modalClosed',
                  () => {
                    setTimeout(() => cart.renderContents(response));
                  },
                  { once: true }
                );
                quickAddModal.hide(true);
              } else {
                cart.renderContents(response);
              }
            })
            .catch((e) => console.error(e))
            .finally(() => {
              pf.submitButton.classList.remove('loading');
              if (cart && cart.classList.contains('is-empty')) cart.classList.remove('is-empty');
              if (!pf.error) pf.submitButton.removeAttribute('aria-disabled');
              pf.querySelector('.loading__spinner').classList.add('hidden');
            });
        }, true); // <-- capture phase: runs BEFORE the original handler
      }
    }
  );
}

if (!customElements.get('cart-personalise-editor')) {
  customElements.define(
    'cart-personalise-editor',
    class CartPersonaliseEditor extends HTMLElement {
      constructor() {
        super();
        this.checkbox = this.querySelector('[data-personalise-toggle]');
        this.editForm = this.querySelector('[data-edit-form]');
        this.summary = this.querySelector('[data-personalise-summary]');
        this.saveBtn = this.querySelector('[data-save]');
        this.cancelBtn = this.querySelector('[data-cancel]');
        this.hasPersonalisation = this.dataset.hasPersonalisation === 'true';
        this._busy = false;
      }

      connectedCallback() {
        this.checkbox.addEventListener('change', () => this.onToggle());
        this.saveBtn.addEventListener('click', () => this.save());
        this.cancelBtn.addEventListener('click', () => this.cancel());
      }

      onToggle() {
        if (this._busy) {
          this.checkbox.checked = !this.checkbox.checked;
          return;
        }
        if (this.checkbox.checked) {
          this.showForm();
        } else {
          this.removePersonalisation();
        }
      }

      showForm() {
        this.editForm.classList.remove('hidden');
        if (this.summary) this.summary.classList.add('hidden');
      }

      hideForm() {
        this.editForm.classList.add('hidden');
      }

      cancel() {
        if (this.hasPersonalisation) {
          this.hideForm();
          if (this.summary) this.summary.classList.remove('hidden');
        } else {
          this.checkbox.checked = false;
          this.hideForm();
        }
      }

      getProperties() {
        const properties = {};
        this.editForm.querySelectorAll('input[type="text"]').forEach((input) => {
          if (input.value.trim()) {
            const key = normalizePropertyName(input.name);
            properties[key] = input.value.trim();
          }
        });
        this.editForm.querySelectorAll('input[type="radio"]:checked').forEach((input) => {
          const key = normalizePropertyName(input.name);
          properties[key] = input.value;
        });
        return properties;
      }

      getCartItems() {
        return this.closest('cart-items') || this.closest('cart-drawer-items');
      }

      getSections() {
        const cartItems = this.getCartItems();
        return cartItems ? cartItems.getSectionsToRender().map((s) => s.section || s.id) : [];
      }

      enableLoading() {
        this._busy = true;
        const target = document.getElementById('CartDrawer') || document.getElementById('main-cart-items');
        if (target) target.classList.add('loading');
      }

      disableLoading() {
        this._busy = false;
        const target = document.getElementById('CartDrawer') || document.getElementById('main-cart-items');
        if (target) target.classList.remove('loading');
      }

      refreshCart() {
        const cartItems = this.getCartItems();
        if (cartItems) {
          cartItems.onCartUpdate();
        } else {
          window.location.reload();
        }
      }

      async removePersonalisation() {
        if (this._busy) return;
        this.enableLoading();
        const itemKey = this.dataset.itemKey;
        const linkedKey = this.dataset.linkedKey;
        const variantId = parseInt(this.dataset.variantId, 10);
        const quantity = parseInt(this.dataset.quantity, 10) || 1;

        try {
          const updates = {};
          updates[itemKey] = 0;
          if (linkedKey) updates[linkedKey] = 0;

          await fetch(`${routes.cart_update_url}`, {
            ...fetchConfig(),
            body: JSON.stringify({ updates }),
          });

          const addBody = {
            items: [{ id: variantId, quantity }],
            sections: this.getSections(),
            sections_url: window.location.pathname,
          };

          await fetch(window.Shopify.routes.root + 'cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(addBody),
          });

          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items' });
          this.refreshCart();
        } catch (e) {
          console.error(e);
          this.checkbox.checked = true;
        } finally {
          this.disableLoading();
        }
      }

      async save() {
        if (this._busy) return;
        this.enableLoading();
        this.saveBtn.classList.add('loading');
        this.saveBtn.textContent = 'Saving...';

        const itemKey = this.dataset.itemKey;
        const linkedKey = this.dataset.linkedKey;
        const variantId = parseInt(this.dataset.variantId, 10);
        const personaliseVariantId = parseInt(this.dataset.personaliseVariantId, 10);
        const quantity = parseInt(this.dataset.quantity, 10) || 1;
        const groupId = this.dataset.personaliseGroup || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));

        const newProps = this.getProperties();
        newProps._personalise_group = groupId;

        try {
          const updates = {};
          updates[itemKey] = 0;
          if (linkedKey) updates[linkedKey] = 0;

          await fetch(`${routes.cart_update_url}`, {
            ...fetchConfig(),
            body: JSON.stringify({ updates }),
          });

          const addBody = {
            items: [
              { id: variantId, quantity, properties: newProps },
              { id: personaliseVariantId, quantity, properties: { _personalise_group: groupId } },
            ],
            sections: this.getSections(),
            sections_url: window.location.pathname,
          };

          const res = await fetch(window.Shopify.routes.root + 'cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(addBody),
          });
          const data = await res.json();

          if (data.status) {
            console.error('Cart add error:', data.description);
            return;
          }

          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items', cartData: data });
          this.refreshCart();
        } catch (e) {
          console.error(e);
        } finally {
          this.saveBtn.classList.remove('loading');
          this.saveBtn.textContent = 'Save';
          this.disableLoading();
        }
      }
    }
  );
}
