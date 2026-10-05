import { apiBlob, baseName, extOf, simpleTool } from '../core.js';
import { compressFields, compressSummary, compressValues } from './server-tool.js';

/* Make images smaller on the NAS. The result keeps the format of the input (PNG stays PNG, HEIC stays HEIC, …). */
export function mount(root, tool) {
  simpleTool(root, {
    tool,
    accept: '.jpg,.jpeg,.jfif,.png,.webp,.heic,.heif,.gif,.bmp,.tif,.tiff,.svg',
    multiple: true,
    actionLabel: 'Compress',
    busyText: 'Squeezing your pictures…',
    intro: 'Every image comes back in its own format. Pick a level, or type the exact size you need ✿',
    fields: [
      ...compressFields('KB'),
      { name: 'max_side', label: 'Also limit the size to (pixels, longest side)', type: 'number', value: '', min: 0, placeholder: 'keep the original size',
        hint: 'Optional. Photos straight from a phone are often 4000 px or more; 2000 px is plenty for screens.' },
    ],
    async run(files, values) {
      const fields = compressValues(values);
      fields.max_side = values.max_side > 0 ? Math.round(values.max_side) : 0;
      const outputs = [];
      for (const file of files) {
        const blob = await apiBlob('/api/images/compress', { file, fields });
        outputs.push({ name: blob.filename || `${baseName(file.name)}-compressed.${extOf(file.name)}`, data: blob, original: file.size });
      }
      return outputs;
    },
    resultExtra: compressSummary,
  });
}
