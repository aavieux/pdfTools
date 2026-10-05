import { apiBlob, baseName, esc, fmtBytes, simpleTool } from '../core.js';

const OCR_LANGS = {
  eng: 'English', deu: 'German', nld: 'Dutch', fra: 'French', spa: 'Spanish', ita: 'Italian',
  bul: 'Bulgarian', rus: 'Russian', por: 'Portuguese',
};

/** “Pick a level” or “Exact file size” — shared by Compress PDF and Compress images. */
export function compressFields(unit) {
  return [
    { name: 'how', label: 'How small?', type: 'radio', value: 'level', options: [['level', 'Pick a level'], ['size', 'Exact file size']] },
    { name: 'level', label: 'Compression', type: 'radio', value: 'medium', options: [['low', 'Light'], ['medium', 'Medium'], ['high', 'High'], ['extreme', 'Extreme']], show: (v) => v.how === 'level' },
    { name: 'target', label: 'At most', type: 'number', value: unit === 'MB' ? 2 : 500, min: 0, step: 'any', show: (v) => v.how === 'size',
      hint: 'Each file is made as close to this size as possible without going over.' },
    { name: 'unit', label: 'Unit', type: 'radio', value: unit, options: [['KB', 'KB'], ['MB', 'MB']], show: (v) => v.how === 'size' },
  ];
}

export function compressValues(v) {
  const { how, level, target, unit, ...rest } = v;
  if (how !== 'size') return { ...rest, level };
  if (!(target > 0)) throw new Error('Please type the size the file should have ♡');
  return { ...rest, target, unit };
}

/** “2.4 MB → 980 KB · 60% smaller” plus a note for files that couldn't reach the size. */
export function compressSummary(outputs) {
  const before = outputs.reduce((s, o) => s + o.original, 0);
  const after = outputs.reduce((s, o) => s + o.data.size, 0);
  const pct = Math.max(0, Math.round((1 - after / before) * 100));
  const missed = outputs.filter((o) => o.data.headers?.get('X-Note') === 'target-not-reached');
  return `<p>${fmtBytes(before)} → <b>${fmtBytes(after)}</b> · ${pct ? `${pct}% smaller 🎉` : 'already as small as it gets ♡'}</p>${
    missed.length ? `<p class="warn" style="max-width:520px;margin:8px auto;text-align:left">I couldn’t get ${missed.length === outputs.length ? (missed.length === 1 ? 'this file' : 'these files') : missed.map((o) => esc(o.name)).join(', ')} all the way down to that size — ${missed.length === 1 ? 'this is' : 'these are'} the smallest I could make without ruining ${missed.length === 1 ? 'it' : 'them'}. Text and drawings can’t be squeezed much; pictures can.</p>` : ''}`;
}

const SPECS = {
  compress: {
    actionLabel: 'Compress',
    multiple: true,
    busyText: 'Squeezing your PDFs… (aiming for an exact size tries a few settings, so it takes a bit longer)',
    intro: 'Pick how small it should get, or type the exact size you need — e.g. the upload limit of a form ✉️',
    fields: [
      ...compressFields('MB'),
      { name: 'grayscale', label: 'Convert to black & white', type: 'checkbox', value: false },
    ],
    prepare: (v) => compressValues(v),
    endpoint: '/api/compress',
    suffix: '-compressed',
  },
  linearize: { actionLabel: 'Optimize for web', multiple: true, endpoint: '/api/linearize', suffix: '-web',
    intro: 'Linearized PDFs show the first page right away while the rest is still loading ✿' },
  ocr: {
    actionLabel: 'Recognize text',
    multiple: true,
    accept: '.pdf,.png,.jpg,.jpeg,.tif,.tiff',
    busyText: 'Reading every page… (this can take a while ♡)',
    endpoint: '/api/ocr',
    suffix: '-ocr',
    fields: [
      { name: 'langs', label: 'Language(s) in the document', type: 'select', value: 'eng', options: [
        ...Object.entries(OCR_LANGS).map(([k, v]) => [k, v]),
        ['eng+deu', 'English + German'], ['eng+nld', 'English + Dutch'], ['eng+bul', 'English + Bulgarian'], ['bul+rus', 'Bulgarian + Russian']] },
      { name: 'mode', label: 'Pages that already have text', type: 'select', value: 'skip', options: [['skip', 'Skip them (fastest)'], ['redo', 'Redo OCR on them'], ['force', 'Rasterize & OCR everything']] },
      { name: 'rotate', label: 'Auto-rotate pages', type: 'checkbox', value: true },
      { name: 'deskew', label: 'Straighten crooked scans', type: 'checkbox', value: false, show: (v) => v.mode === 'force' },
      { name: 'clean', label: 'Clean up scanner noise', type: 'checkbox', value: false, show: (v) => v.mode === 'force' },
      { name: 'output', label: 'Output', type: 'select', value: 'pdf', options: [['pdf', 'Searchable PDF'], ['pdfa', 'Searchable PDF/A']] },
    ],
  },
  repair: { actionLabel: 'Repair', multiple: true, endpoint: '/api/repair', suffix: '-repaired',
    intro: 'I try three different engines until one can rescue your file 🩹' },
  flatten: {
    actionLabel: 'Flatten', multiple: true, endpoint: '/api/flatten', suffix: '-flat',
    fields: [{ name: 'mode', label: 'Flatten', type: 'radio', value: 'all', options: [['all', 'Forms + annotations'], ['forms', 'Forms only']] }],
  },
  pdfa: {
    actionLabel: 'Convert to PDF/A', multiple: true, endpoint: '/api/pdfa', suffix: '-pdfa',
    busyText: 'Making it archive-proof…',
    fields: [
      { name: 'part', label: 'PDF/A version', type: 'radio', value: '2', options: [['1', 'PDF/A-1b'], ['2', 'PDF/A-2b'], ['3', 'PDF/A-3b']], hint: 'PDF/A-2b is the usual choice.' },
      { name: 'ocr', label: 'Also make scanned pages searchable (OCR)', type: 'checkbox', value: false },
    ],
  },
  protect: {
    actionLabel: 'Protect', endpoint: '/api/protect', suffix: '-protected',
    intro: 'Uses AES-256 encryption. Don’t forget your password — I can’t recover it 🙀',
    fields: [
      { name: 'user_password', label: 'Password to open', type: 'password', placeholder: 'needed to open the PDF' },
      { name: 'user_password2', label: 'Repeat password', type: 'password' },
      { name: 'owner_password', label: 'Permissions password (optional)', type: 'password', hint: 'Needed to change permissions. Leave empty to use the same password.' },
      { name: 'print', label: 'Allow printing', type: 'checkbox', value: true },
      { name: 'copy', label: 'Allow copying text & images', type: 'checkbox', value: true },
      { name: 'modify', label: 'Allow changing the document', type: 'checkbox', value: true },
      { name: 'annotate', label: 'Allow comments', type: 'checkbox', value: true },
      { name: 'forms', label: 'Allow filling forms', type: 'checkbox', value: true },
    ],
    prepare(v) {
      if (!v.user_password && !v.owner_password) throw new Error('Please enter a password ♡');
      if (v.user_password !== v.user_password2) throw new Error('The two passwords are not the same');
      return {
        user_password: v.user_password,
        owner_password: v.owner_password,
        allow: JSON.stringify({ print: v.print, copy: v.copy, modify: v.modify, annotate: v.annotate, forms: v.forms }),
      };
    },
  },
  unlock: {
    actionLabel: 'Unlock', multiple: true, endpoint: '/api/unlock', suffix: '-unlocked',
    fields: [{ name: 'password', label: 'Password', type: 'password', hint: 'Leave empty if the PDF opens without a password but has restrictions.' }],
  },
  'remove-metadata': { actionLabel: 'Remove metadata', multiple: true, endpoint: '/api/remove-metadata', suffix: '-clean',
    intro: 'Removes title, author, creator app, dates, XMP data and page thumbnails 🧹' },
  'extract-images': {
    actionLabel: 'Extract images', multiple: true, endpoint: '/api/extract-images', suffix: '-images', ext: 'zip',
    fields: [
      { name: 'format', label: 'Format', type: 'radio', value: 'original', options: [['original', 'Keep original (JPG/PNG)'], ['png', 'Always PNG']] },
      { name: 'min_size', label: 'Skip images smaller than (px)', type: 'number', value: 32, min: 0 },
    ],
  },
};

export function mount(root, tool) {
  const spec = SPECS[tool.opts.op];
  simpleTool(root, {
    tool,
    accept: spec.accept || '.pdf',
    multiple: spec.multiple,
    manyOutputs: spec.ext === 'zip',
    fields: spec.fields || [],
    actionLabel: spec.actionLabel,
    busyText: spec.busyText,
    intro: spec.intro,
    async run(files, values) {
      const fields = spec.prepare ? spec.prepare(values) : values;
      const outputs = [];
      for (const file of files) {
        const blob = await apiBlob(spec.endpoint, { file, fields });
        outputs.push({ name: blob.filename || `${baseName(file.name)}${spec.suffix}.${spec.ext || 'pdf'}`, data: blob, original: file.size, unzip: spec.ext === 'zip' });
      }
      return outputs;
    },
    resultExtra: tool.opts.op === 'compress' ? compressSummary : undefined,
  });
}
