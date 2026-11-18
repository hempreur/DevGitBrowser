#!/usr/bin/env python3
"""Génère app/src/main/assets/i18n-en.json : textes t("…") du code Kotlin, traduits depuis i18n/en.json du
navigateur PC, complétés par android/i18n-en-extra.json. Échoue si une traduction manque."""
import glob, json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
src = ''.join(open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(here, 'app/src/main/java/**/*.kt'), recursive=True))
keys = sorted({k.replace('\\"', '"') for k in re.findall(r'\bt\("((?:[^"\\]|\\.)*)"\)', src)})
# Catalogue DGBx (ui/x-catalog.js) : titres de catégories et prix affichés avec t(…).
cat = open(os.path.join(here, '..', 'ui', 'x-catalog.js'), encoding='utf-8').read()
keys = sorted(set(keys) | set(re.findall(r"title: '([^']*)'", cat)) | set(re.findall(r"price: '([^']*)'", cat)))
desktop = json.load(open(os.path.join(here, '..', 'i18n', 'en.json'), encoding='utf-8'))
extra = json.load(open(os.path.join(here, 'i18n-en-extra.json'), encoding='utf-8'))
out, missing = {}, []
for k in keys:
    v = extra.get(k, desktop.get(k))
    if v is None: missing.append(k)
    else: out[k] = v
dest = os.path.join(here, 'app/src/main/assets/i18n-en.json')
with open(dest, 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True); f.write('\n')
if missing:
    print('Traductions manquantes :', *missing, sep='\n  '); sys.exit(1)
print(f'{len(out)} textes traduits')
