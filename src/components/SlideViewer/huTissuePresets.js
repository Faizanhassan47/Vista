/** Standard CT Hounsfield ranges for threshold presets (display aid, not a diagnosis). */
export const HU_TISSUE_PRESETS = [
  {
    id: 'air',
    label: 'Air',
    min: -1000,
    max: -990,
    rangeLabel: '−1000',
    use: 'Background removal, trachea, and airway segmentation',
  },
  {
    id: 'lung',
    label: 'Lung parenchyma',
    min: -950,
    max: -400,
    rangeLabel: '−950 to −400',
    use: 'Lung volume and pulmonary nodule isolation',
  },
  {
    id: 'fat',
    label: 'Fat (adipose tissue)',
    min: -190,
    max: -30,
    rangeLabel: '−190 to −30',
    use: 'Body composition and visceral fat analysis',
  },
  {
    id: 'water',
    label: 'Water / CSF',
    min: 0,
    max: 15,
    rangeLabel: '0 to +15',
    use: 'Fluid collections, cysts, and brain ventricles',
  },
  {
    id: 'soft',
    label: 'Soft tissue & muscle',
    min: 10,
    max: 100,
    rangeLabel: '+10 to +100',
    use: 'Organs, muscle, and unenhanced blood',
  },
  {
    id: 'contrast',
    label: 'Contrast-enhanced blood',
    min: 100,
    max: 400,
    rangeLabel: '+100 to +400',
    use: 'Angiography, heart chambers, and vascular trees',
  },
  {
    id: 'cancellous',
    label: 'Cancellous (spongy) bone',
    min: 150,
    max: 400,
    rangeLabel: '+150 to +400',
    use: 'Inner bone structure and trabecular analysis',
  },
  {
    id: 'cortical',
    label: 'Cortical (dense) bone',
    min: 400,
    max: 2000,
    rangeLabel: '+400 to +2000',
    use: 'Skeletal segmentation and fracture modeling',
  },
  {
    id: 'metal',
    label: 'Metal / implants',
    min: 3000,
    max: 8000,
    rangeLabel: '> +3000',
    use: 'Dental fillings, prosthetics, and artifact masking',
  },
];

export function findHuTissuePreset(id) {
  return HU_TISSUE_PRESETS.find((item) => item.id === id) || null;
}
