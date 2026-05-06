#!/usr/bin/env python3
"""
Batch process all books for llm-wiki ingestion - NO EXTERNAL DEPENDENCIES
"""
import os
import re
from datetime import datetime

# Configuration
BOOKS_DIR = "/Users/aykut/Documents/llm-wiki/raw/books"
WIKI_DIR = "/Users/aykut/Documents/llm-wiki/wiki/concepts"

# Topic extraction patterns
TOPIC_KEYWORDS = {
    'coatings': ['coating', 'paint', 'film', 'substrate', 'binder'],
    'pigment': ['pigment', 'colorant', 'dye', 'titanium dioxide', 'TiO2'],
    'polymer': ['polymer', 'resin', 'epoxy', 'polyurethane', 'polyester', 'acrylic'],
    'additive': ['additive', 'surfactant', 'dispersant', 'thickener'],
    'corrosion': ['corrosion', 'anticorrosive'],
    'rheology': ['rheology', 'viscosity', 'thixotropy'],
    'chemical-engineering': ['reactor', 'distillation', 'heat transfer'],
    'color-science': ['color', 'chromatic', 'spectral', 'reflectance', 'CIELAB', 'RGB'],
    'machine-learning': ['neural network', 'deep learning', 'algorithm', 'genetic'],
}

def extract_title(content):
    """Extract title from markdown"""
    lines = content.strip().split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip()
        elif line and not line.startswith('!') and not line.startswith('[') and not line.startswith('#'):
            if len(line) > 3:
                return line.strip()
    return "Untitled"

def determine_type(title):
    t = title.lower()
    if 'arxiv' in t or 'research' in t:
        return 'academic-paper'
    elif 'handbook' in t or 'textbook' in t:
        return 'textbook'
    elif 'chemistry' in t:
        return 'chemistry'
    else:
        return 'technical-book'

def extract_topics(content, title):
    text = (content + ' ' + title).lower()
    found = []
    for topic, keywords in TOPIC_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                if topic not in found:
                    found.append(topic)
                break
    return found if found else ['coatings']

def add_yaml_header(content, title):
    doc_type = determine_type(title)
    topics = extract_topics(content, title)
    date_str = datetime.now().strftime('%Y-%m-%d')

    topic_lines = '\n  - '.join(topics)

    yaml_block = f"""---
type: {doc_type}
topics:
  - {topic_lines}
date_ingested: {date_str}
---

# {title}

"""

    if content.startswith('---'):
        return content

    return yaml_block + content

def make_folder_name(title):
    s = re.sub(r'[^\w\s-]', '', title)
    s = re.sub(r'\s+', '_', s)
    return s[:50]

def process_all():
    files = os.listdir(BOOKS_DIR)
    md_files = [f for f in files if f.endswith('.md')]

    print(f"Found {len(md_files)} .md files to process")
    count = 0

    for i, filename in enumerate(md_files, 1):
        try:
            filepath = os.path.join(BOOKS_DIR, filename)
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            title = extract_title(content)
            if not title or title == "Untitled":
                title = filename.replace('.md', '')

            folder_name = make_folder_name(title)
            folder_path = os.path.join(WIKI_DIR, folder_name)
            os.makedirs(folder_path, exist_ok=True)

            processed = add_yaml_header(content, title)
            output_path = os.path.join(folder_path, filename)

            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(processed)

            print(f"[{i}/{len(md_files)}] {title[:60]}")
            count += 1

        except Exception as e:
            print(f"ERROR {filename}: {e}")

    print(f"\nDone! Processed {count} files to {WIKI_DIR}")

if __name__ == '__main__':
    process_all()