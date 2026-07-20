# Putting the map on biochar.org

The map is a standalone web page published by GitHub Pages. You place it on
biochar.org by embedding that page in an iframe. WordPress does not host the
tiles, so the site stays light and there is nothing to maintain in WordPress.

## Steps

1. Copy your published Pages URL from the finished workflow run, for example
   `https://<your-account>.github.io/biochar-national-map/`.
2. In WordPress, open or create the page where the map should appear, for example
   a "Biochar Soil Map" page.
3. Add a **Custom HTML** block and paste the snippet below, with your Pages URL in
   the `src`:

   ```html
   <iframe
     src="https://YOUR-ACCOUNT.github.io/biochar-national-map/"
     title="Biochar Soil Suitability Atlas - National Map"
     loading="lazy"
     style="width:100%; height:680px; border:0; border-radius:8px; overflow:hidden;">
   </iframe>
   ```

4. Publish or update the page. The map appears inside your normal biochar.org
   header, footer, and navigation.

## Notes

- Adjust `height` to taste. 680px suits a full-width content column; use 560px in
  a narrower template.
- The page is responsive, so it fills whatever width the iframe gives it.
- No plugin is required. A Custom HTML block is enough. Avoid pasting the iframe
  into a plain paragraph block, since WordPress can strip iframe tags there.
- If your theme sandboxes iframes, allow this one to load normally; it needs no
  special permissions, only outbound tile requests.

## Optional: a cleaner URL

If you would rather the map live at `https://biochar.org/soil-map/` than a
github.io address, point a subdomain or path at GitHub Pages with a custom domain
(GitHub **Settings -> Pages -> Custom domain**) and a DNS record. The iframe then
uses your own domain. This is optional and does not change the build.
