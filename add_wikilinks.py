#!/usr/bin/env python3
"""
Add wikilinks to first 20 documents
"""
import os
import re

WIKI_DIR = "/Users/aykut/Documents/llm-wiki/wiki/concepts"

# Internal links mapping (term -> existing concept or other book)
WIKILINKS = {
    # Pigment & Color
    'pigment': '[[pigment]]',
    'pigments': '[[pigment]]',
    'colorant': '[[pigment]]',
    'colorants': '[[pigment]]',
    'TiO2': '[[titanium-dioxide]]',
    'titanium dioxide': '[[titanium-dioxide]]',

    # Process terms
    'dispersion': '[[pigment-dispersion]]',
    'dispersing': '[[pigment-dispersion]]',
    'grinding': '[[pigment-dispersion]]',
    'mixing': '[[mixing]]',
    'agitation': '[[mixing]]',

    # Coating types
    'coating': '[[coating]]',
    'coatings': '[[coating]]',
    'paint': '[[paint]]',
    'paints': '[[paint]]',
    'film': '[[film-formation]]',

    # Equipment
    'bead mill': '[[bead-mill]]',
    'sand mill': '[[sand-mill]]',
    'three roll mill': '[[three-roll-mill]]',
    'disperser': '[[disperser]]',

    # Color science
    'Kubelka-Munk': '[[Kubelka-Munk]]',
    'CIELAB': '[[CIELAB]]',
    'RGB': '[[RGB]]',
    'spectral': '[[spectralmatching]]',
    'reflectance': '[[reflectance]]',

    # Models
    'CFD': '[[CFD]]',
    'RANS': '[[turbulence-models]]',
    'turbulence': '[[turbulence-models]]',

    # Polymers
    'polymer': '[[polymer]]',
    'resin': '[[resin]]',
    'epoxy': '[[epoxy]]',
    'polyurethane': '[[polyurethane]]',
    'acrylic': '[[acrylic]]',

    # Existing concepts
    'dead zone': '[[dead-zones]]',
    'dead zones': '[[dead-zones]]',
    'homogeneity': '[[homogeneity-metrics]]',
    'mixing time': '[[mixing-time]]',
    'impeller': '[[impeller]]',
}

def add_wikilinks(content, filename):
    """Add wikilinks to content"""

    lines = content.split('\n')
    new_lines = []
    changes = 0

    for line in lines:
        original = line

        # Skip YAML header and already linked lines
        if line.startswith('---') or line.startswith('#'):
            new_lines.append(line)
            continue

        # Replace terms with wikilinks
        for term, link in WIKILINKS.items():
            # Case-insensitive replacement
            pattern = re.compile(re.escape(term), re.IGNORECASE)
            if pattern.search(line) and link not in line:
                # Check if not already linked
                if '[[' not in line and ']]' not in line.split(term)[0][-10:]:
                    line = pattern.sub(link, line, count=1)
                    changes += 1

        new_lines.append(line)

    return '\n'.join(new_lines), changes

# Process first 20 folders
folders = sorted(os.listdir(WIKI_DIR))
doc_folders = [f for f in folders if os.path.isdir(os.path.join(WIKI_DIR, f))]

print(f"Processing {len(doc_folders)} documents...")

for i, folder in enumerate(doc_folders, 1):
    folder_path = os.path.join(WIKI_DIR, folder)
    md_files = [f for f in os.listdir(folder_path) if f.endswith('.md')]

    for md_file in md_files:
        filepath = os.path.join(folder_path, md_file)

        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            processed, changes = add_wikilinks(content, md_file)

            if changes > 0:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(processed)
                print(f"[{i}/{len(doc_folders)}] {folder[:45]}: {changes} links added")
        except Exception as e:
            print(f"ERROR {folder}: {e}")

print("\nDone!")