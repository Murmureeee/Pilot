# @env node
import sys
import time

import pyatspi


def descendants(element):
    yield element
    try:
        children = list(element)
    except Exception:
        return
    for child in children:
        if child is not None:
            yield from descendants(child)


def find(parent, predicate):
    for element in descendants(parent):
        try:
            if predicate(element):
                return element
        except Exception:
            continue
    return None


desktop = pyatspi.Registry.getDesktop(0)
title = sys.argv[1]
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    dialog = find(desktop, lambda element: element.name == title)
    if dialog is not None:
        accept = find(
            dialog,
            lambda element: element.getRole() == pyatspi.ROLE_PUSH_BUTTON
            and element.name.lstrip("_").lower() in {"open", "select"}
            and element.getState().contains(pyatspi.STATE_SENSITIVE),
        )
        if accept is not None:
            if not accept.queryAction().doAction(0):
                raise RuntimeError("The GTK directory chooser did not accept the directory")
            sys.exit(0)
    time.sleep(0.2)

if dialog is not None:
    names = [(element.getRoleName(), element.name) for element in descendants(dialog) if element.name]
    print("GTK chooser accessibility controls:", names, file=sys.stderr)
raise RuntimeError("The native directory chooser or its Open button was unavailable")
