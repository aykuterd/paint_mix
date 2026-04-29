#!/usr/bin/env python3
"""Replace pageCFD HTML and inline CFD JS with new modular version."""
import sys

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Read new HTML
with open('cfd-page.html', 'r', encoding='utf-8') as f:
    new_html = f.read()

# 1) Replace HTML section (lines 1284-1554, 1-indexed)
# Find exact boundaries
html_start = None
html_end = None
for i, line in enumerate(lines):
    if 'id="pageCFD"' in line and 'display:none' in line:
        html_start = i
    if '<!-- end #pageCFD -->' in line and html_start is not None:
        html_end = i
        break

if html_start is None or html_end is None:
    print(f"ERROR: Could not find pageCFD boundaries. start={html_start}, end={html_end}")
    sys.exit(1)

print(f"HTML section: lines {html_start+1} to {html_end+1}")

# 2) Find JS section boundaries
js_start = None
js_end = None
for i, line in enumerate(lines):
    if 'CFD ENGINE' in line and 'Eksenel' in line:
        js_start = i
    if 'cfdBuildVelocityField(params)' in line and 'cfdInit' in line.strip()[:20] if False else False:
        pass

# More precise: find the CFD ENGINE comment and the cfdInit IIFE end
for i, line in enumerate(lines):
    if '// CFD ENGINE' in line and 'r-z' in line:
        js_start = i
    if 'function cfdInit()' in line.strip() and 'cfdInit' in line:
        # Find the closing })();
        pass

# Find js_start: "// CFD ENGINE"
# Find js_end: the line with "})();" after cfdInit
for i, line in enumerate(lines):
    if '// =============' in line and i > 3500:
        if js_start is None:
            js_start = i
    if 'cfdInit' in line and '()' in line and i > 4100:
        # Find the closing
        for j in range(i, min(i+5, len(lines))):
            if '})();' in lines[j] or '()' in lines[j]:
                js_end = j
                break
        if js_end is None:
            js_end = i

# Fallback: use line numbers from the analysis
if js_start is None:
    js_start = 3513  # 0-indexed for line 3514
if js_end is None:
    js_end = 4117    # 0-indexed for line 4118

print(f"JS section: lines {js_start+1} to {js_end+1}")

# Build new file
# Part 1: everything before pageCFD
new_lines = lines[:html_start]

# Part 2: new HTML
new_lines.append(new_html + '\n')

# Part 3: everything between pageCFD end and JS start
new_lines.extend(lines[html_end+1:js_start])

# Part 4: replacement for inline JS - just script tags for external files
new_js = """        // ============================================================
        // CFD ENGINE v2 — Loaded from external modules
        // ============================================================
        // (Engine, Renderer, and UI Controller loaded via <script> tags)

        // Tab switching — CFD tab is handled in cfd-ui.js
        // Other tab switches need to stop CFD
        ['tabMixing','tabDispersion','tabUygunluk'].forEach(id => {
            const existing = document.getElementById(id);
            if (existing) existing.addEventListener('click', () => { if (typeof CFD !== 'undefined' && CFD.running) cfdStopSim(); });
        });

"""
new_lines.append(new_js)

# Part 5: everything after JS section
new_lines.extend(lines[js_end+1:])

# Now add script tags before </body>
result = ''.join(new_lines)

# Insert script tags before the closing </script> of the main block
# Actually, add them right before </body>
result = result.replace('</body>', '''    <script src="cfd-engine.js"></script>
    <script src="cfd-render.js"></script>
    <script src="cfd-ui.js"></script>
</body>''')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(result)

print("Done! index.html updated successfully.")
print(f"Total lines: {result.count(chr(10))}")
