# Product-specific decor layouts

Source: read-only HTML of the five original `https://lady-elka.ru/catalog-tree/<slug>` pages, captured 2026-10-08. Only `.product-wrapper__cms` is retained. Legacy `data-action-element` attributes are removed; the wreath material question uses the existing owned modal `data-modal-open="i1icj56y5_0"`.

`generate-products.mjs` combines these layouts with the common page shell, then `product-page.mjs` replaces title, description, images/gallery, variant controls, price and purchase with catalog data. No product-specific values are hardcoded in JS.

The current `decor.csv` has only `id,title,category,price,variants,photos,active,description`. Basket dimensions/material, Vesta dimensions/branches, wreath branches and PE material are original editorial markup, not feed fields. Wreath description is empty in the feed while the original retains its editorial description. Feed descriptions take priority when nonempty; explicit `-` suppresses the editorial fallback. Editorial data must be migrated into the feed schema before it can be edited in the cabinet; these fragments must not be described as feed-backed properties.
