import { apiBlob, baseName, simpleTool } from '../core.js';

const TARGETS = [
  ['docx', 'Word (.docx)'], ['xlsx', 'Excel (.xlsx)'], ['pptx', 'PowerPoint (.pptx)'],
  ['odt', 'OpenDocument Text (.odt)'], ['ods', 'OpenDocument Spreadsheet (.ods)'], ['odp', 'OpenDocument Presentation (.odp)'],
  ['rtf', 'Rich Text (.rtf)'], ['txt', 'Plain text (.txt)'], ['md', 'Markdown (.md)'], ['html', 'Web page (.html)'],
  ['epub', 'E-book (.epub)'], ['svg', 'SVG vector images'], ['tiff', 'Multi-page TIFF'],
];
const NOTES = {
  docx: 'Text, tables and images become editable in Word ✿',
  xlsx: 'Tables become spreadsheet rows; every page gets its own sheet 📈',
  pptx: 'Each page becomes a slide with editable shapes and text 📊',
};

export function mount(root, tool) {
  const fixed = tool.opts.target;
  simpleTool(root, {
    tool,
    multiple: true,
    manyOutputs: !fixed || fixed === 'svg' || fixed === 'tiff',
    actionLabel: 'Convert',
    busyText: 'Converting your PDF…',
    intro: NOTES[fixed],
    fields: fixed ? [] : [{ name: 'target', label: 'Convert to', type: 'select', value: 'docx', options: TARGETS }],
    async run(files, values) {
      const target = fixed || values.target;
      const outputs = [];
      for (const file of files) {
        const blob = await apiBlob('/api/convert/from-pdf', { file, fields: { target } });
        outputs.push({ name: blob.filename || `${baseName(file.name)}.${target}`, data: blob, unzip: blob.type === 'application/zip' });
      }
      return outputs;
    },
  });
}
