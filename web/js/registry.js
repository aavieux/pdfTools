/*
 * Every tool shown on the home page.
 *  module: file in js/tools/ that implements it
 *  opts:   passed to the module's mount()
 *  nas:    true when the work happens on the NAS server (otherwise it stays in the browser)
 */

/*
 * Tools are grouped by what they do with your files:
 *   make   – turn other files into a PDF
 *   adjust – work on a PDF and get a PDF back
 *   export – turn a PDF into other files
 *   design – make something new (cards, collages)
 *   extras – images and little helpers
 * Each group has its own colour, which the filter chips, headings and tool icons use.
 */
export const GROUPS = [
  ['make', 'Make a PDF', '📥', 'hsl(27 62% 58%)'],
  ['adjust', 'Adjust a PDF', '🛠️', 'hsl(336 52% 60%)'],
  ['export', 'PDF to other files', '🔁', 'hsl(217 52% 58%)'],
  ['design', 'Create & design', '🎨', 'hsl(258 45% 63%)'],
  ['extras', 'Images & extras', '🧰', 'hsl(155 38% 44%)'],
];

export const CATEGORIES = [
  ['to-pdf', 'make', 'Convert to PDF', '📥'],
  ['edit', 'adjust', 'Edit', '🖍️'],
  ['organize', 'adjust', 'Organize pages', '🗂️'],
  ['optimize', 'adjust', 'Optimize & repair', '🔧'],
  ['security', 'adjust', 'Security & privacy', '🔒'],
  ['view', 'adjust', 'View & check', '🔍'],
  ['from-pdf', 'export', 'Convert from PDF', '📤'],
  ['create', 'design', 'Cards & collages', '💌'],
  ['images', 'extras', 'Images', '🖼️'],
  ['extras', 'extras', 'Little helpers', '🧸'],
];

const t = (id, cat, icon, name, desc, module, opts = {}, nas = false) => ({ id, cat, icon, name, desc, module, opts, nas });

export const TOOLS = [
  // Make a PDF
  t('convert-to-pdf', 'to-pdf', '📥', 'Convert to PDF', 'Any file to PDF: Word, Excel, PowerPoint, images, text, EPUB, …', 'convert-to-pdf', { accept: '*' }, true),
  t('camera-pdf', 'to-pdf', '📸', 'Create PDF with a camera', 'Snap pages with your webcam or phone and make a PDF', 'camera'),

  // Adjust a PDF
  t('edit-pdf', 'edit', '🖍️', 'Edit PDF', 'Add text, images, shapes, highlights and notes to a PDF', 'editor-tool', { mode: 'edit' }),
  t('make-fillable', 'edit', '🔲', 'Make PDF fillable', 'Add form fields to an existing PDF or edit its form', 'editor-tool', { mode: 'fillable' }),
  t('watermark', 'edit', '💧', 'Add watermark', 'Stamp text or an image on every page', 'stamp', { mode: 'watermark' }),
  t('page-numbers', 'edit', '🔢', 'Add page numbers', 'Number the pages of a PDF', 'stamp', { mode: 'numbers' }),
  t('overlay', 'edit', '🗞️', 'PDF Overlay', 'Lay one PDF over another, e.g. letterhead paper', 'overlay'),
  t('crop', 'edit', '✂️', 'Crop PDF', 'Crop pages to remove margins, page by page', 'crop'),
  t('page-size', 'edit', '📐', 'Change PDF page size', 'Change or unify page sizes', 'page-size'),
  t('doc-info', 'edit', 'ℹ️', 'Change document information', 'Edit title, author, subject and keywords', 'doc-info', { mode: 'info' }),

  t('merge', 'organize', '📎', 'Merge PDF', 'Combine several PDFs into one', 'merge'),
  t('assemble', 'organize', '🧺', 'Assemble PDF', 'Move pages between several documents, merge and split', 'assemble'),
  t('split', 'organize', '🔪', 'Split PDF', 'Split a PDF into several files', 'split'),
  t('rearrange', 'organize', '🔀', 'Rearrange PDF pages', 'Drag pages into a new order', 'organize', { mode: 'rearrange' }),
  t('remove-pages', 'organize', '🗑️', 'Remove PDF pages', 'Delete pages from a PDF', 'organize', { mode: 'remove' }),
  t('extract-pages', 'organize', '📑', 'Extract PDF pages', 'Pull selected pages into a new PDF', 'organize', { mode: 'extract' }),
  t('rotate', 'organize', '🔄', 'Rotate PDF pages', 'Rotate single pages or all of them', 'organize', { mode: 'rotate' }),
  t('pages-per-sheet', 'organize', '🔳', 'Pages per sheet', 'Put several pages on one sheet', 'nup'),
  t('bookmarks', 'organize', '🔖', 'Bookmark PDF', 'Add, change and remove bookmarks', 'bookmarks', {}, true),

  t('compress', 'optimize', '🗜️', 'Compress PDF', 'Make PDF files smaller, or shrink them to an exact size', 'server-tool', { op: 'compress' }, true),
  t('web-optimize', 'optimize', '⚡', 'Web optimize PDF', 'Linearize PDFs for fast web viewing', 'server-tool', { op: 'linearize' }, true),
  t('ocr', 'optimize', '🔤', 'PDF OCR', 'Recognize text and make PDFs searchable', 'server-tool', { op: 'ocr' }, true),
  t('repair', 'optimize', '🩹', 'Repair PDF', 'Fix damaged PDF files', 'server-tool', { op: 'repair' }, true),
  t('rasterize', 'optimize', '🧱', 'Rasterize PDF', 'Turn every page into an image', 'render-pages', { mode: 'rasterize' }),
  t('flatten', 'optimize', '🥞', 'Flatten PDF', 'Bake forms and annotations into the pages', 'server-tool', { op: 'flatten' }, true),
  t('pdfa', 'optimize', '🏛️', 'PDF to PDF/A', 'Convert to PDF/A for long-term archiving', 'server-tool', { op: 'pdfa' }, true),

  t('protect', 'security', '🔐', 'Protect PDF', 'Add a password and set permissions', 'server-tool', { op: 'protect' }, true),
  t('unlock', 'security', '🔓', 'Unlock PDF', 'Remove the password from a PDF', 'server-tool', { op: 'unlock' }, true),
  t('sign', 'security', '🖋️', 'Sign PDF', 'Draw, type or upload your signature and place it', 'editor-tool', { mode: 'sign' }),
  t('redact', 'security', '⬛', 'Redact PDF', 'Permanently black out text and areas', 'editor-tool', { mode: 'redact' }, true),
  t('remove-metadata', 'security', '🧹', 'Remove PDF metadata', 'Strip all metadata from a PDF', 'server-tool', { op: 'remove-metadata' }, true),

  t('viewer', 'view', '👀', 'View as PDF', 'Read PDFs (and view other files as PDF)', 'viewer'),
  t('compare', 'view', '⚖️', 'Compare PDFs', 'See what changed between two PDFs', 'compare'),
  t('search', 'view', '🔎', 'Search in PDFs', 'Find text in many PDFs at once', 'search'),
  t('verify-signatures', 'view', '🛡️', 'Verify PDF signatures', 'Check digital signatures and integrity', 'report', { op: 'verify-signatures' }, true),
  t('viewer-prefs', 'view', '🎛️', 'Set PDF viewer preferences', 'Choose how PDF readers open the file', 'doc-info', { mode: 'prefs' }),

  // PDF to other files
  t('pdf-to', 'from-pdf', '📤', 'Convert PDF to…', 'Word, Excel, PowerPoint, OpenDocument, text, HTML, EPUB, …', 'pdf-to', { target: null }, true),
  t('pdf-to-word', 'from-pdf', '📝', 'PDF to Word', 'Editable Word document (.docx)', 'pdf-to', { target: 'docx' }, true),
  t('pdf-to-excel', 'from-pdf', '📈', 'PDF to Excel', 'Tables become spreadsheet rows (.xlsx)', 'pdf-to', { target: 'xlsx' }, true),
  t('pdf-to-powerpoint', 'from-pdf', '📊', 'PDF to PowerPoint', 'Every page becomes a slide (.pptx)', 'pdf-to', { target: 'pptx' }, true),
  t('pdf-to-images', 'from-pdf', '🖼️', 'PDF to images', 'Save pages as JPG or PNG', 'render-pages', { mode: 'images', format: null }),
  t('extract-images', 'from-pdf', '🏞️', 'Extract PDF images', 'Save all images embedded in a PDF', 'server-tool', { op: 'extract-images' }, true),
  t('copy-from-pdf', 'from-pdf', '📋', 'Copy from PDF', 'Click paragraphs, tables and pictures to copy them', 'copy-from', {}, true),

  // Create & design
  t('photo-collage', 'create', '🧩', 'Create photo collage', 'Arrange photos on a page with templates, text and stickers', 'collage', {}, true),
  t('create-card', 'create', '💌', 'Create card', 'Postcards, greeting cards, invitations and vouchers', 'card', {}, true),

  // Images & extras
  t('compress-images', 'images', '🗜️', 'Compress images', 'Smaller JPG, PNG, WEBP, HEIC, GIF, TIFF… in the same format', 'image-compress', {}, true),
  t('heic-to-jpg', 'images', '📷', 'HEIC to JPG', 'Convert HEIC photos to JPG', 'image-convert', { from: 'heic', to: 'jpg' }, true),
  t('heic-to-png', 'images', '📷', 'HEIC to PNG', 'Convert HEIC photos to PNG', 'image-convert', { from: 'heic', to: 'png' }, true),
  t('psd-to-png', 'images', '🖌️', 'PSD to PNG', 'Photoshop files to PNG, transparency kept', 'image-convert', { from: 'psd', to: 'png' }, true),
  t('webp-to-jpg', 'images', '🌅', 'WEBP to JPG', 'Convert WEBP images to JPG', 'image-convert', { from: 'webp', to: 'jpg' }),
  t('webp-to-png', 'images', '🌅', 'WEBP to PNG', 'Convert WEBP images to PNG', 'image-convert', { from: 'webp', to: 'png' }),
  t('qr-code', 'extras', '🔳', 'Generate QR code', 'Make cute, styled QR codes', 'qr'),
  t('password', 'extras', '🎲', 'Generate password', 'Make a strong random password', 'password'),
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((x) => [x.id, x]));
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(([id, group, name, icon]) => [id, { id, group, name, icon }]));
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map(([id, name, icon, color]) => [id, { id, name, icon, color }]));
for (const tool of TOOLS) tool.color = GROUP_BY_ID[CATEGORY_BY_ID[tool.cat].group].color;

/** Groups in the order the user arranged them (Customize → Layout), plus whether each is shown. */
export function orderedGroups() {
  const order = Prefs.get('groupOrder').filter((id) => GROUP_BY_ID[id]);
  for (const [id] of GROUPS) if (!order.includes(id)) order.push(id);
  const hidden = Prefs.get('hiddenGroups');
  return order.map((id) => ({ ...GROUP_BY_ID[id], hidden: hidden.includes(id) }));
}
