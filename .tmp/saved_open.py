import re, sys
root = 'e:/Versara/src/features/pdf/'
for name in ['edit-pdf-pages.tsx', 'arrange-pdf-pages.tsx']:
    path = root + name
    s = open(path, encoding='utf8').read()
    old_save = "const saved = await savePdfResult({ ...outputs[0], name: filename }, initialSelection?.origin, initialSelection?.origin ? undefined : { mode: 'new', name: filename });"
    new_save = "const saved = await savePdfResult({ ...outputs[0], name: filename }, initialSelection?.origin, initialSelection?.origin ? undefined : { mode: 'new', name: filename }, false);"
    assert s.count(old_save) == 1, (name, 'save')
    s = s.replace(old_save, new_save)
    old_toast = "      if (saved) toast('PDF saved');\n"
    new_toast = "      if (saved) { toast(`Saved to ${saved.device.location}`); if (mounted.current) showSavedPdf(saved.file, initialSelection?.returnRoute); }\n"
    assert s.count(old_toast) == 1, (name, 'toast')
    s = s.replace(old_toast, new_toast)
    old_result = "      const saved = await savePdfResult(result, initialSelection?.origin);\n      if (saved && mounted.current) setResult(current => current && { ...current, uri: saved.file.uri, name: saved.file.name, location: saved.device.location });\n"
    new_result = "      const saved = await savePdfResult(result, initialSelection?.origin, undefined, false);\n      if (saved && mounted.current) setResult(current => current && { ...current, uri: saved.file.uri, name: saved.file.name, location: saved.device.location });\n      if (saved) { toast(`Saved to ${saved.device.location}`); if (mounted.current) showSavedPdf(saved.file, initialSelection?.returnRoute); }\n"
    assert s.count(old_result) == 1, (name, 'result')
    s = s.replace(old_result, new_result)
    s = s.replace("import { openPdfResult } from './open-pdf-screen';", "import { openPdfResult, showSavedPdf } from './open-pdf-screen';")
    open(path, 'w', encoding='utf8', newline='').write(s)
print('ok')
