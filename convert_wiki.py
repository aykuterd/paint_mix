#!/usr/bin/env python3
"""
Convert ALL wiki files (raw + synthesized) to Karpathy format
"""
import os
import re
from datetime import datetime

WIKI_DIR = "/Users/aykut/Documents/llm-wiki/wiki"

KARPATRY_TEMPLATE = """# {title}

**Kategori:** {category}
**Etiketler:** {tags}
**Güncelleme:** {date}
**Kaynaklar:** Ham kaynaklardan sentetize edilmiştir.

---

## Özet

{summary}

---

## İçerik

{body}

---

## İlgili Sayfalar
{related}

---

*Bu sayfa Karpathy LLM Wiki pattern'e uygun sentetize edilmiştir."""

def extract_title(content):
    lines = content.strip().split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip().replace('#', '').strip()[:80]
    return "Untitled"

def detect_category(path, filename):
    p = path.lower()
    f = filename.lower()
    if 'model' in p or 'ade' in f or 'correlation' in f or 'chaotic' in f or 'cfd' in f or 'lattice' in p:
        return 'models'
    if 'model' in p or 'rheology' in p:
        return 'models'
    if 'pigment' in p or 'dispers' in f or 'color' in p:
        return 'pigments'
    if 'equipment' in p or 'mill' in f or 'disperser' in f or 'impeller' in p:
        return 'equipment'
    if 'impeller' in p:
        return 'impellers'
    if 'synthesis' in p:
        return 'synthesis'
    if 'equipment' in p or 'coating' in f or 'paint':
        return 'concepts'
    return 'concepts'

def get_tags(content, title):
    text = (content + ' ' + title).lower()
    tags = []

    keywords = {
        'coating': ['coating', 'paint', 'film', 'binder'],
        'pigment': ['pigment', 'colorant', 'tio2', 'dye'],
        'polymer': ['polymer', 'resin', 'epoxy', 'polyurethane'],
        'rheology': ['rheology', 'viscosity', 'thixotropy', 'newtonian'],
        'mixing': ['mixing', 'homogen', 'cov', 'blend', 'blending'],
        'additive': ['additive', 'surfactant', 'thickener'],
        'equipment': ['mill', 'disperser', 'impeller'],
        'color-science': ['cielab', 'rgb', 'k-m', 'kubelka'],
        'cfd': ['cfd', 'rans', 'les', 'dns'],
        'particle': ['particle', 'd50', 'grinding'],
    }

    for tag, kws in keywords.items():
        for kw in kws:
            if kw in text:
                if tag not in tags:
                    tags.append(tag)
                break

    return tags if tags else ['general']

def make_summary(content, max_len=200):
    lines = []
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('!') or len(line) < 20:
            continue
        lines.append(line)
        if len(lines) >= 3:
            break
    summary = ' '.join(lines[:2])
    if len(summary) > max_len:
        summary = summary[:max_len-3] + '...'
    return summary.strip()

def get_related(content):
    links = re.findall(r'\[\[([^\]]+)\]\]', content)
    seen = []
    for link in links[:5]:
        if link not in seen:
            seen.append(link)
    return '\n'.join([f'- [[{l}]]' for l in seen])

def get_body(content, max_chars=3000):
    # Skip YAML header if present
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) > 2:
            content = parts[2]

    # Get main content (first meaningful section)
    lines = []
    in_body = False
    for line in content.split('\n'):
        line = line.strip()
        if line.startswith('# ') and not in_body:
            in_body = True
            continue
        if in_body and line and not line.startswith('#'):
            lines.append(line)
        if len('\n'.join(lines)) > max_chars:
            break

    body = '\n'.join(lines[:100])  # First 100 lines
    if len(body) > max_chars:
        body = body[:max_chars-3] + '...'
    return body.strip()

def process_file(filepath, folder):
    filename = os.path.basename(filepath)

    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except:
        return False

    # Check if already Karpathy format
    if '**Kategori:**' in content:
        return False  # Already converted

    title = extract_title(content)
    category = detect_category(filepath, filename)
    tags = get_tags(content, title)
    summary = make_summary(content)
    body = get_body(content)
    related = get_related(content)
    date_str = datetime.now().strftime('%Y-%m-%d')

    tags_str = ', '.join(tags)

    new_content = KARPATRY_TEMPLATE.format(
        title=title,
        category=category,
        tags=tags_str,
        date=date_str,
        summary=summary,
        body=body,
        related=related if related else '- (bağlantı yok)'
    )

    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    except:
        return False

def main():
    all_files = []

    for root, dirs, files in os.walk(WIKI_DIR):
        for f in files:
            if f.endswith('.md'):
                all_files.append(os.path.join(root, f))

    print(f"Total markdown files: {len(all_files)}")

    converted = 0
    skipped = 0

    for filepath in all_files:
        folder = os.path.basename(os.path.dirname(filepath))

        if process_file(filepath, folder):
            converted += 1
            if converted % 20 == 0:
                print(f"Converted {converted}...")
        else:
            skipped += 1

    print(f"\nDone! Converted {converted} files, skipped {skipped}")

if __name__ == '__main__':
    main()