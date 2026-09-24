import { chromium } from '@playwright/test';

/** A single form/standalone input field extracted from the page. */
export interface FieldSummary {
  /** The element tag name in lowercase (e.g. `input`, `textarea`, `select`). */
  tag: string;
  /** The `type` attribute for inputs (e.g. `text`, `email`, `password`). */
  type?: string;
  /** The `name` attribute, if present. */
  name?: string;
  /** The `id` attribute, if present. */
  id?: string;
  /** The visible/associated label text, if any. */
  label?: string;
  /** The `placeholder` attribute, if present. */
  placeholder?: string;
  /** Whether the field is marked required. */
  required?: boolean;
  /** The ARIA role Playwright would resolve for this field. */
  role?: string;
  /** The accessible name (label > aria-label > placeholder), if derivable. */
  accessibleName?: string;
}

/** A form element and its collected fields. */
export interface FormSummary {
  /** The form `id`, if present. */
  id?: string;
  /** The form `name`, if present. */
  name?: string;
  /** The form `action` attribute, if present. */
  action?: string;
  /** The fields contained within the form. */
  fields: FieldSummary[];
}

/** A clickable button element. */
export interface ButtonSummary {
  /** The button's trimmed visible text. */
  text: string;
  /** The resolved ARIA role (typically `button`). */
  role: string;
  /** The accessible name, if derivable. */
  accessibleName?: string;
}

/** A hyperlink on the page. */
export interface LinkSummary {
  /** The link's trimmed visible text. */
  text: string;
  /** The resolved `href`. */
  href: string;
}

/** A heading element. */
export interface HeadingSummary {
  /** The heading level (1-3). */
  level: number;
  /** The trimmed heading text. */
  text: string;
}

/** A structured, role-aware summary of a crawled page. */
export interface PageSummary {
  /** The document title. */
  title: string;
  /** The final page URL. */
  url: string;
  /** Deduped headings (h1-h3), capped. */
  headings: HeadingSummary[];
  /** Forms and their fields. */
  forms: FormSummary[];
  /** Input-like elements that live outside any form. */
  inputs: FieldSummary[];
  /** Buttons detected on the page. */
  buttons: ButtonSummary[];
  /** Links detected on the page, capped. */
  links: LinkSummary[];
}

/** Upper bound on the number of headings retained in a summary. */
const MAX_HEADINGS = 15;
/** Upper bound on the number of links retained in a summary. */
const MAX_LINKS = 20;

/**
 * Crawl a single page with Chromium and extract a structured {@link PageSummary}.
 *
 * Navigates using the `domcontentloaded` lifecycle event (no hard waits) and
 * pulls out headings, forms, standalone inputs, buttons, and links. Field and
 * button extraction favors accessible names so that generated tests can prefer
 * role-based locators. The browser is always closed in a `finally` block.
 *
 * @param url - The absolute URL to crawl.
 * @returns A resolved {@link PageSummary} describing the page.
 */
export async function crawlPage(url: string): Promise<PageSummary> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // tsx/esbuild's `keepNames` wraps named inner functions with `__name(...)`
    // calls; that helper is not serialized into the page context, so define a
    // no-op shim there first. The string form bypasses the esbuild transform.
    await page.evaluate('window.__name = window.__name || function (t) { return t; };');

    const summary = await page.evaluate(
      ({ maxHeadings, maxLinks }) => {
        /** Best-effort accessible name for a form control. */
        function labelFor(el: Element): string | undefined {
          const id = el.getAttribute('id');
          if (id) {
            const escaped = window.CSS && window.CSS.escape ? window.CSS.escape(id) : id;
            const explicit = document.querySelector(`label[for="${escaped}"]`);
            const text = explicit?.textContent?.trim();
            if (text) return text;
          }
          const wrapping = el.closest('label');
          const wrapText = wrapping?.textContent?.trim();
          if (wrapText) return wrapText;
          return undefined;
        }

        /** Derive an accessible name from label, aria-label, or placeholder. */
        function accessibleNameFor(el: Element, label?: string): string | undefined {
          const aria = el.getAttribute('aria-label')?.trim();
          const placeholder = el.getAttribute('placeholder')?.trim();
          return label || aria || placeholder || undefined;
        }

        /** Map an input-like element to a role Playwright would resolve. */
        function roleFor(el: Element): string | undefined {
          const explicit = el.getAttribute('role')?.trim();
          if (explicit) return explicit;
          const tag = el.tagName.toLowerCase();
          if (tag === 'textarea') return 'textbox';
          if (tag === 'select') return 'combobox';
          if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            switch (type) {
              case 'checkbox':
                return 'checkbox';
              case 'radio':
                return 'radio';
              case 'button':
              case 'submit':
              case 'reset':
                return 'button';
              case 'range':
                return 'slider';
              case 'email':
              case 'tel':
              case 'url':
              case 'text':
              case 'search':
                return 'textbox';
              default:
                return 'textbox';
            }
          }
          return undefined;
        }

        /** Build a {@link FieldSummary}-shaped object for a control. */
        function fieldOf(el: Element) {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type')?.trim() || undefined;
          const name = el.getAttribute('name')?.trim() || undefined;
          const id = el.getAttribute('id')?.trim() || undefined;
          const label = labelFor(el);
          const placeholder = el.getAttribute('placeholder')?.trim() || undefined;
          const required =
            el.hasAttribute('required') || el.getAttribute('aria-required') === 'true'
              ? true
              : undefined;
          const role = roleFor(el);
          const accessibleName = accessibleNameFor(el, label);
          return { tag, type, name, id, label, placeholder, required, role, accessibleName };
        }

        // Headings (h1-h3), trimmed, deduped, capped.
        const seenHeadings = new Set<string>();
        const headings: { level: number; text: string }[] = [];
        for (const el of Array.from(document.querySelectorAll('h1, h2, h3'))) {
          const text = el.textContent?.trim();
          if (!text) continue;
          const level = Number(el.tagName.substring(1));
          const key = `${level}:${text}`;
          if (seenHeadings.has(key)) continue;
          seenHeadings.add(key);
          headings.push({ level, text });
          if (headings.length >= maxHeadings) break;
        }

        const controlSelector = 'input, textarea, select';

        // Forms and their fields.
        const forms = Array.from(document.querySelectorAll('form')).map((form) => {
          const id = form.getAttribute('id')?.trim() || undefined;
          const name = form.getAttribute('name')?.trim() || undefined;
          const action = form.getAttribute('action')?.trim() || undefined;
          const fields = Array.from(form.querySelectorAll(controlSelector))
            .filter((el) => (el.getAttribute('type') || '').toLowerCase() !== 'hidden')
            .map(fieldOf);
          return { id, name, action, fields };
        });

        // Standalone inputs (outside any form).
        const inputs = Array.from(document.querySelectorAll(controlSelector))
          .filter((el) => !el.closest('form'))
          .filter((el) => (el.getAttribute('type') || '').toLowerCase() !== 'hidden')
          .map(fieldOf);

        // Buttons: <button>, input[type=submit|button], and role="button".
        const seenButtons = new Set<string>();
        const buttonEls = Array.from(
          document.querySelectorAll(
            'button, input[type="submit"], input[type="button"], [role="button"]',
          ),
        );
        const buttons: { text: string; role: string; accessibleName?: string }[] = [];
        for (const el of buttonEls) {
          const value = el.getAttribute('value')?.trim();
          const aria = el.getAttribute('aria-label')?.trim();
          const text = (el.textContent?.trim() || value || aria || '').trim();
          if (!text) continue;
          if (seenButtons.has(text)) continue;
          seenButtons.add(text);
          buttons.push({ text, role: 'button', accessibleName: aria || text || undefined });
        }

        // Links, absolute href, capped, skipping empty/# anchors.
        const seenLinks = new Set<string>();
        const links: { text: string; href: string }[] = [];
        for (const el of Array.from(document.querySelectorAll('a[href]'))) {
          const raw = el.getAttribute('href')?.trim();
          if (!raw || raw === '#' || raw.startsWith('javascript:')) continue;
          const href = (el as HTMLAnchorElement).href || raw;
          const text = el.textContent?.trim();
          if (!text) continue;
          if (seenLinks.has(href)) continue;
          seenLinks.add(href);
          links.push({ text, href });
          if (links.length >= maxLinks) break;
        }

        return {
          title: document.title,
          url: window.location.href,
          headings,
          forms,
          inputs,
          buttons,
          links,
        };
      },
      { maxHeadings: MAX_HEADINGS, maxLinks: MAX_LINKS },
    );

    return summary;
  } finally {
    await browser.close();
  }
}
