#!/usr/bin/env python3
"""Replace pageCFD HTML section with new modular version."""
import sys

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Read new HTML
with open('cfd-page.html', 'r', encoding='utf-8') as f:
    new_html = f.read()

# 1) Find pageCFD HTML section boundaries
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

# 2) Find the CFD ENGINE comment block start — replace only that block,
#    keeping everything after it (</script>, </body>, </html>) intact.
js_start = None
for i, line in enumerate(lines):
    if '// =============' in line and i > html_end:
        # Confirm it's the CFD ENGINE marker
        window = ''.join(lines[i:min(i+4, len(lines))])
        if 'CFD ENGINE' in window:
            js_start = i
            break

# The JS section to replace ends just before </script>
js_end = None
if js_start is not None:
    for i in range(js_start, len(lines)):
        if '</script>' in lines[i]:
            js_end = i - 1  # keep </script> and everything after
            break

# If no </script> found after js_start, replace to end of file — should not happen
if js_start is None:
    print("ERROR: Could not find CFD ENGINE JS block start.")
    sys.exit(1)

if js_end is None:
    # No </script> found: file was already broken; replace to EOF and re-add footer
    js_end = len(lines) - 1
    missing_footer = True
else:
    missing_footer = False

print(f"JS section: lines {js_start+1} to {js_end+1} (missing_footer={missing_footer})")

# Build new file
new_lines = lines[:html_start]                  # before pageCFD
new_lines.append(new_html + '\n')               # new pageCFD HTML
new_lines.extend(lines[html_end+1:js_start])    # between pageCFD end and JS block

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

if missing_footer:
    # Re-add the footer that was lost
    new_lines.append("""    </script>
    <script src="cfd-engine.js"></script>
    <script src="cfd-render.js"></script>
    <script src="cfd-ui.js"></script>
</body>
</html>
""")
else:
    # Keep </script> and everything after (</body>, </html>, external scripts)
    new_lines.extend(lines[js_end+1:])

result = ''.join(new_lines)

# Safety: ensure external CFD scripts are referenced before </body>
if 'cfd-engine.js' not in result:
    result = result.replace('</body>', """    <script src="cfd-engine.js"></script>
    <script src="cfd-render.js"></script>
    <script src="cfd-ui.js"></script>
</body>""")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(result)

print("Done! index.html updated successfully.")
print(f"Total lines: {result.count(chr(10))}")
