import { Activity, Microscope, ScanSearch, ShieldCheck, Shapes, Sparkles } from 'lucide-react';

export const AI_LISTING = [
  { code: 'HOVERNET', name: 'HoVer-Net', route: '/', icon: Activity, category: 'Cell analysis', summary: 'AI-assisted nuclei detection, segmentation, and classification for whole-slide image review.', purpose: 'Locates individual nuclei, separates touching cells, and groups detected nuclei into supported cell classes.', value: 'Reduces repetitive visual counting and provides a consistent quantitative starting point for pathologist review.', outputs: ['Nuclei overlay', 'Cell-type counts', 'Density and morphology'], featured: true },
  { code: 'TUMOR_DETECTION', name: 'Tumor Detection', route: null, icon: ScanSearch, category: 'Region detection', summary: 'Highlights candidate regions that may contain tumor for focused pathologist inspection.', purpose: 'Screens tissue regions and marks areas whose visual patterns warrant closer professional review.', value: 'Helps prioritize large slides and supports a systematic review without replacing diagnostic judgment.', outputs: ['Candidate regions', 'Visual heatmap', 'Review priorities'] },
  { code: 'MITOTIC_DETECTION', name: 'Mitotic Figure Detection', route: null, icon: Sparkles, category: 'Cell analysis', summary: 'Identifies candidate mitotic figures for confirmation during microscopic assessment.', purpose: 'Detects cell appearances associated with mitosis and presents candidates for pathologist verification.', value: 'Supports efficient mitotic assessment while keeping final classification with the pathologist.', outputs: ['Candidate markers', 'Region counts', 'Review queue'] },
  { code: 'IMAGE_QC', name: 'AI Slide Quality Control', route: null, icon: ShieldCheck, category: 'Quality control', summary: 'Checks digitized slides for technical quality issues before clinical review.', purpose: 'Assesses focus, blur, folds, artifacts, and other image conditions that may affect interpretation.', value: 'Surfaces scanning problems earlier, reducing avoidable review delays and unnecessary repeat handling.', outputs: ['Quality status', 'Issue locations', 'Rescan guidance'] },
  { code: 'TISSUE_SEGMENTATION', name: 'Tissue Segmentation', route: null, icon: Shapes, category: 'Tissue analysis', summary: 'Separates supported tissue structures into regions for research and quantitative review.', purpose: 'Maps tissue compartments such as epithelium and stroma when a compatible validated model is available.', value: 'Creates structured regions that can support downstream measurements and research workflows.', outputs: ['Tissue masks', 'Region measurements', 'Overlay layers'] },
];

export const AI_LISTING_BY_CODE = Object.fromEntries(AI_LISTING.map((feature) => [feature.code, feature]));

export const AI_WORKSPACES = [
  { id: 'pathology', label: 'Pathology viewer (WSI)' },
  { id: 'radiology', label: 'Radiology viewer (DICOM / NIfTI)' },
];

const RADIOLOGY_ONLY_CODES = new Set(['NEUROMRI_SLICE_CLASSIFICATION', 'TOTALSEGMENTATOR']);

export function featureWorkspaces(feature) {
  if (Array.isArray(feature?.catalog_workspaces) && feature.catalog_workspaces.length) {
    return feature.catalog_workspaces.map((item) => String(item).toLowerCase());
  }
  try {
    const parsed = JSON.parse(feature?.catalog_workspaces_json || '[]');
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((item) => String(item).toLowerCase());
    }
  } catch {
    /* use defaults */
  }
  if (RADIOLOGY_ONLY_CODES.has(feature?.feature_code)) return ['radiology'];
  return ['pathology'];
}

export function featureVisibleInWorkspace(feature, workspace) {
  return featureWorkspaces(feature).includes(workspace);
}

export function modelListing(feature) {
  const fallback = AI_LISTING_BY_CODE[feature.feature_code] || { icon: Microscope, category: 'Pathology AI', summary: feature.description, purpose: feature.description, value: 'Provides governed decision support within the digital pathology workflow.', outputs: ['Assisted review'] };
  let savedOutputs = [];
  try { savedOutputs = JSON.parse(feature.catalog_outputs_json || '[]'); } catch { savedOutputs = []; }
  const hasSavedCard = Boolean(feature.catalog_category || feature.catalog_summary || feature.catalog_purpose || feature.catalog_value || feature.catalog_outputs_json);
  return {
    ...fallback,
    title: feature.catalog_title || feature.feature_name || fallback.name,
    category: feature.catalog_category || fallback.category,
    summary: feature.catalog_summary || fallback.summary,
    purpose: feature.catalog_purpose || fallback.purpose,
    value: feature.catalog_value || fallback.value,
    outputs: savedOutputs.length ? savedOutputs : fallback.outputs,
    featured: hasSavedCard ? Boolean(feature.is_featured) : Boolean(fallback.featured),
    workspaces: featureWorkspaces(feature),
  };
}
