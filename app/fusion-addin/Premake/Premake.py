# Premake for Autodesk Fusion: hover a body to see what it costs to make, select bodies and click to get a quote
# from manufacturers (Premake estimate now; live RMFG / AFN shop prices on the quote page; local shops next).
#
#   Buy parts       command: hover = instant price, select + OK = upload STEP files and open the quote page
#   Connect Premake command: one-time link to your Premake account (device code, approved in the browser)
#
# Config: ~/.premake-fusion.json  {"server": "https://premake.ai", "token": "pmk_..."}  (written by Connect)
import adsk.core, adsk.fusion, traceback
import base64, json, os, tempfile, time, urllib.request, urllib.error, webbrowser

CMD_BUY = 'premakeBuyParts'
CMD_CONNECT = 'premakeConnect'
PANEL = 'SolidScriptsAddinsPanel'
CONFIG = os.path.expanduser('~/.premake-fusion.json')
MATERIALS = [('auto', 'Auto (from the Fusion material)'), ('aluminum_6061', 'Aluminum 6061 (CNC / sheet)'),
             ('steel', 'Mild steel'), ('stainless_304', 'Stainless 304'), ('petg_print', 'PETG, 3D printed'),
             ('acrylic_laser', 'Acrylic, laser cut')]

app = adsk.core.Application.get()
ui = app.userInterface
handlers = []          # Fusion drops event handlers that aren't referenced
cache = {}             # (entityToken, material, qty) -> estimate dict


# ---------------------------------------------------------------- config + http
def config():
    try:
        with open(CONFIG) as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(c):
    with open(CONFIG, 'w') as f:
        json.dump(c, f)
    try:
        os.chmod(CONFIG, 0o600)
    except Exception:
        pass


def server():
    return (config().get('server') or 'https://premake.ai').rstrip('/')


def call(path, body, timeout=4, auth=True):
    headers = {'Content-Type': 'application/json', 'User-Agent': 'Premake-Fusion/0.1'}
    tok = config().get('token')
    if auth and tok:
        headers['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(server() + path, data=json.dumps(body).encode(), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode() or '{}') | {'_status': e.code}
        except Exception:
            return {'error': 'HTTP %d' % e.code, '_status': e.code}
    except Exception as e:
        return {'error': str(e)}


# ---------------------------------------------------------------- body -> part features (Fusion works in cm)
def features(body, material, qty):
    bb = body.boundingBox
    size = [round((bb.maxPoint.x - bb.minPoint.x) * 10, 2), round((bb.maxPoint.y - bb.minPoint.y) * 10, 2),
            round((bb.maxPoint.z - bb.minPoint.z) * 10, 2)]
    props = body.physicalProperties
    mat = material
    if material == 'auto':
        try:
            mat = body.material.name
        except Exception:
            mat = ''
    owner = body.parentComponent.name if body.parentComponent else ''
    name = body.name if not owner or body.name.startswith(owner) else '%s / %s' % (owner, body.name)
    return {'name': name, 'bbox_mm': size, 'volume_mm3': round(props.volume * 1000, 1),
            'area_mm2': round(props.area * 100, 1), 'material': mat, 'qty': qty}


def estimate(body, material, qty):
    key = (body.entityToken, material, qty)
    if key in cache:
        return cache[key]
    r = call('/api/fusion/estimate', {'parts': [features(body, material, qty)]}, timeout=3)
    est = (r.get('parts') or [None])[0] if not r.get('error') else {'error': r.get('error')}
    if est and not est.get('error'):
        cache[key] = est
    return est or {'error': 'no answer'}


def describe(est):
    if not est or est.get('error'):
        return (est or {}).get('error') or 'No price'
    return '%s\n~$%.2f each · %s · %s · about %d days\n%s' % (
        est.get('name', 'Part'), est['each_usd'], est.get('material_label', ''), est.get('process', '').replace('_', ' '),
        est.get('lead_days', 0), est.get('why', ''))


# ---------------------------------------------------------------- Buy parts command
def inputs_of(cmd):
    i = cmd.commandInputs
    sel = i.itemById('parts')
    mat = MATERIALS[[m[1] for m in MATERIALS].index(i.itemById('material').selectedItem.name)][0]
    qty = i.itemById('qty').value
    return i, sel, mat, qty


def refresh_total(cmd):
    i, sel, mat, qty = inputs_of(cmd)
    total, lines = 0.0, []
    for k in range(sel.selectionCount):
        body = adsk.fusion.BRepBody.cast(sel.selection(k).entity)
        if not body:
            continue
        est = estimate(body, mat, qty)
        if est and not est.get('error'):
            total += est['total_usd']
            lines.append('%s: $%.2f × %d' % (est.get('name', 'Part'), est['each_usd'], qty))
    i.itemById('total').text = ('\n'.join(lines) + '\n\nEstimated total: $%.2f' % total) if lines else 'Select the parts you want made.'


class PreSelect(adsk.core.SelectionEventHandler):
    def notify(self, args):
        try:
            body = adsk.fusion.BRepBody.cast(args.selection.entity)
            if not body:
                return
            i, sel, mat, qty = inputs_of(args.firingEvent.sender)
            i.itemById('hover').text = describe(estimate(body, mat, qty))
        except Exception:
            pass


class InputChanged(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            refresh_total(args.firingEvent.sender)
        except Exception:
            pass


class Execute(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            if not config().get('token'):
                ui.messageBox('Connect Premake first (Add-ins → Connect Premake).')
                return
            i, sel, mat, qty = inputs_of(args.command)
            parts, tmpdir = [], tempfile.mkdtemp(prefix='premake-')
            mgr = adsk.fusion.TemporaryBRepManager.get()
            for k in range(sel.selectionCount):
                body = adsk.fusion.BRepBody.cast(sel.selection(k).entity)
                if not body:
                    continue
                p = features(body, mat, qty)
                f = os.path.join(tmpdir, 'part-%d.step' % (k + 1))
                try:
                    mgr.exportToFile([mgr.copy(body)], f)
                    with open(f, 'rb') as fh:
                        p['step_b64'] = base64.b64encode(fh.read()).decode()
                except Exception:
                    pass  # priced from its size alone
                parts.append(p)
            if not parts:
                ui.messageBox('Select at least one body.')
                return
            doc = app.activeDocument.name if app.activeDocument else ''
            r = call('/api/fusion/quote', {'parts': parts, 'doc': doc, 'source': 'fusion'}, timeout=60)
            if r.get('url'):
                webbrowser.open(r['url'])
            else:
                ui.messageBox('Premake couldn\'t make the quote: %s' % (r.get('error') or 'unknown error'))
        except Exception:
            ui.messageBox('Premake error:\n%s' % traceback.format_exc())


class BuyCreated(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = args.command
            cmd.okButtonText = 'Get quote'
            i = cmd.commandInputs
            sel = i.addSelectionInput('parts', 'Parts', 'Hover a body to see its price; click to add it')
            sel.addSelectionFilter('SolidBodies')
            sel.setSelectionLimits(0, 0)
            dd = i.addDropDownCommandInput('material', 'Material', adsk.core.DropDownStyles.TextListDropDownStyle)
            for k, (_, label) in enumerate(MATERIALS):
                dd.listItems.add(label, k == 0)
            i.addIntegerSpinnerCommandInput('qty', 'Quantity', 1, 10000, 1, 1)
            i.addTextBoxCommandInput('hover', 'Hover', 'Hover a part to see what it costs to make.', 4, True)
            i.addTextBoxCommandInput('total', 'Selected', 'Select the parts you want made.', 6, True)
            for ev, h in ((cmd.preSelect, PreSelect()), (cmd.inputChanged, InputChanged()), (cmd.execute, Execute())):
                ev.add(h)
                handlers.append(h)
            if not config().get('token'):
                i.itemById('hover').text = 'Connect Premake first (Add-ins → Connect Premake) to see prices.'
        except Exception:
            ui.messageBox('Premake error:\n%s' % traceback.format_exc())


# ---------------------------------------------------------------- Connect command (device flow)
class ConnectCreated(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        h = ConnectExecute()
        args.command.execute.add(h)
        handlers.append(h)
        args.command.isAutoExecute = True


class ConnectExecute(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            r = call('/api/fusion/connect/start', {}, auth=False)
            if not r.get('url'):
                ui.messageBox('Couldn\'t reach Premake: %s' % (r.get('error') or 'unknown error'))
                return
            webbrowser.open(r['url'])
            ui.messageBox('Your browser opened Premake.\n\nCheck the code is %s, click Connect there, then click OK here.' % r['user_code'],
                          'Connect Premake')
            for _ in range(10):
                t = call('/api/fusion/connect/token', {'device_code': r['device_code']}, auth=False)
                if t.get('token'):
                    c = config()
                    c['token'] = t['token']
                    save_config(c)
                    cache.clear()
                    ui.messageBox('Connected to Premake as %s.' % t.get('user', 'you'))
                    return
                if t.get('error') != 'authorization_pending':
                    break
                time.sleep(2)
            ui.messageBox('Not connected yet. Click Connect in the browser, then run Connect Premake again.')
        except Exception:
            ui.messageBox('Premake error:\n%s' % traceback.format_exc())


# ---------------------------------------------------------------- add-in lifecycle
def run(context):
    try:
        for cid, name, tip, created in ((CMD_BUY, 'Buy parts', 'Hover a part to see what it costs to make, then get it made', BuyCreated()),
                                         (CMD_CONNECT, 'Connect Premake', 'Link this add-in to your Premake account', ConnectCreated())):
            d = ui.commandDefinitions.itemById(cid) or ui.commandDefinitions.addButtonDefinition(cid, name, tip)
            d.commandCreated.add(created)
            handlers.append(created)
            panel = ui.allToolbarPanels.itemById(PANEL)
            if panel and not panel.controls.itemById(cid):
                ctl = panel.controls.addCommand(d)
                if cid == CMD_BUY:
                    ctl.isPromoted = True
    except Exception:
        ui.messageBox('Premake failed to start:\n%s' % traceback.format_exc())


def stop(context):
    try:
        panel = ui.allToolbarPanels.itemById(PANEL)
        for cid in (CMD_BUY, CMD_CONNECT):
            if panel and panel.controls.itemById(cid):
                panel.controls.itemById(cid).deleteMe()
            d = ui.commandDefinitions.itemById(cid)
            if d:
                d.deleteMe()
    except Exception:
        pass
