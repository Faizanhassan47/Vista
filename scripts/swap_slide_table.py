from pathlib import Path

path = Path(r"d:\Code\Hello\first\frontend\src\modules\slides\SlideLibrary.jsx")
text = path.read_text(encoding="utf-8")
start = text.find("{view === 'table' ?")
end = text.find(' : <div className="slide-library__cards-layout">')
if start < 0 or end < 0:
    raise SystemExit(f"markers missing {start} {end}")
replacement = """{view === 'table' ? <><ReferenceTable rows={pageSlides} rowKey={(slide) => slide.id} onRowClick={(slide) => navigate(`/cases?case=${slide.caseId}&slide=${slide.id}`)} empty="No slides found." columns={[
      { key: 'sr', label: 'Sr. #', render: (_, index) => page * pageSize + index + 1 },
      { key: 'slide', label: 'Slide ID', render: (slide) => slide.label || `Slide ${slide.id}` },
      { key: 'case', label: 'Case ID', render: (slide) => slide.caseLabel || `Case ${slide.caseId}` },
      { key: 'patientId', label: 'Patient ID', render: (slide) => slide.patientId || 'Not recorded' },
      { key: 'patientName', label: 'Patient Name', render: (slide) => slide.patientName || 'Not recorded' },
      { key: 'pathologist', label: 'Pathologist', render: (slide) => slide.pathologist || 'Unassigned' },
      { key: 'status', label: 'Status', render: (slide) => slide.status },
      { key: 'uploaded', label: 'Uploaded', render: (slide) => formatDate(slide.created_at) },
    ]} /><Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} label="Slide library pages" /></>"""
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
print("ok")
