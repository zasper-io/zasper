import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('keeps documentation and takes out anything that runs', () => {
    const clean = sanitizeHtml(
      '<p onclick="steal()">Println <code>fmt</code></p><script>steal()</script><img src=x onerror="steal()">'
    );

    expect(clean).toContain('<code>fmt</code>');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onerror');
  });
});
