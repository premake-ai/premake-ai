'use strict';
// STEP files are read by py/partinfo.py (CadQuery / OpenCascade) in a child process: a clean environment, the part's
// own folder as working directory, a 120 s timeout and a memory cap. PYTHON picks the interpreter (default python3).
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'py', 'partinfo.py');
const TIMEOUT_MS = 120e3;

/** -> facts { bbox_mm, volume_mm3, area_mm2, solids, faces, mesh } or { error } */
function analyzeStep(dir, file, mesh) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH, HOME: dir, PYTHONDONTWRITEBYTECODE: '1', OMP_NUM_THREADS: '1' };
    const child = spawn(process.env.PYTHON || 'python3', [SCRIPT, path.join(dir, file), path.join(dir, mesh)], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', (d) => { if (out.length < 1e6) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `STEP reader unavailable (${e.code || e.message})` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ error: 'took too long to read' });
      let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch {}
      if (j && !j.error) return resolve(j);
      // SystemExit(json) from partinfo.py lands on stderr
      let e = null; try { e = JSON.parse(err.trim().split('\n').pop()).error; } catch {}
      resolve({ error: (j?.error || e || err.trim().split('\n').pop() || `exit ${code}`).slice(0, 200) });
    });
  });
}
module.exports = { analyzeStep };
