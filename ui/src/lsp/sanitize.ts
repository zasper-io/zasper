import DOMPurify from 'dompurify';

/**
 * A language server's documentation is Markdown, which may carry HTML, and a compromised server should
 * not be able to run anything through a hover.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style'],
  });
}
