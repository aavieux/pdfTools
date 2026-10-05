"""Electronic invoices (EN 16931): XRechnung / ZUGFeRD / Factur-X, CII and UBL."""

import datetime
import html
import re
from collections import OrderedDict
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import facturx
from fastapi import HTTPException
from lxml import etree

XRECHNUNG_ID = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
PEPPOL_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
EN16931_ID = "urn:cen.eu:en16931:2017"

UNITS = {"C62": "piece", "H87": "piece", "HUR": "hour", "DAY": "day", "MON": "month", "KGM": "kg", "MTR": "m",
         "LTR": "l", "MTK": "m²", "KMT": "km", "MIN": "minute", "WEE": "week", "ANN": "year", "SET": "set", "LS": "lump sum"}
VAT_CATEGORIES = {"S": "Standard rate", "Z": "Zero rated", "E": "Exempt", "AE": "Reverse charge", "K": "Intra-community supply",
                  "G": "Export outside the EU", "O": "Not subject to VAT", "L": "Canary Islands", "M": "Ceuta and Melilla"}
TWO = Decimal("0.01")


def D(v) -> Decimal:
    if v is None or v == "":
        return Decimal(0)
    try:
        return Decimal(str(v).replace(",", ".")) if not isinstance(v, Decimal) else v
    except InvalidOperation as err:
        raise HTTPException(400, f"“{v}” is not a number.") from err


def money(v) -> Decimal:
    return D(v).quantize(TWO, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- simple model -> EN16931 dict

def compute(model: dict) -> dict:
    """Compute line amounts, VAT breakdown and totals from the simple invoice model."""
    lines = []
    groups: "OrderedDict[tuple, Decimal]" = OrderedDict()
    for i, ln in enumerate(model.get("lines") or []):
        if not (ln.get("name") or "").strip():
            continue
        qty = D(ln.get("qty") or 1)
        price = D(ln.get("price"))
        net = money(qty * price)
        cat = ln.get("vat_category") or ("S" if D(ln.get("vat_rate")) > 0 else "Z")
        rate = D(ln.get("vat_rate")) if cat in ("S", "L", "M") else Decimal(0)
        lines.append({**ln, "id": str(len(lines) + 1), "qty": qty, "price": price, "net": net, "cat": cat, "rate": rate})
        groups[(cat, rate)] = groups.get((cat, rate), Decimal(0)) + net
    if not lines:
        raise HTTPException(400, "Please add at least one invoice line.")
    vat = [{"cat": c, "rate": r, "base": money(b), "tax": money(b * r / 100)} for (c, r), b in groups.items()]
    line_total = money(sum(l["net"] for l in lines))
    tax_total = money(sum(v["tax"] for v in vat))
    grand = line_total + tax_total
    paid = money(model.get("paid_amount") or 0)
    return {"lines": lines, "vat": vat, "line_total": line_total, "tax_total": tax_total,
            "grand_total": grand, "paid": paid, "due": grand - paid}


def _party(p: dict, xrechnung: bool, is_seller: bool) -> dict:
    out = {
        "name": p.get("name") or "",
        "addr_l1": p.get("street") or None,
        "addr_l2": p.get("street2") or None,
        "postcode": p.get("postcode") or None,
        "city": p.get("city") or None,
        "country_code": (p.get("country") or "DE").upper()[:2],
        "vat_identifier": p.get("vat_id") or None,
        "tax_identifier": p.get("tax_id") or None,
        "legal_identifier": p.get("registration") or None,
    }
    email = p.get("email") or None
    if email:
        out["einvoicing_addr"] = email
        out["einvoicing_addr_schemeid"] = "EM"
    if p.get("contact_name") or p.get("phone") or email:
        out["contacts"] = [{"name": p.get("contact_name") or None, "phone": p.get("phone") or None, "email": email}]
    return {k: v for k, v in out.items() if v not in (None, "")}


def to_en16931(model: dict, xrechnung: bool) -> dict:
    c = compute(model)
    cur = (model.get("currency") or "EUR").upper()
    data = {
        "BT-1": model.get("number") or "",
        "BT-2": model.get("issue_date") or datetime.date.today().isoformat(),
        "BT-3": model.get("type_code") or "380",
        "BT-5": cur,
        "BT-24": EN16931_ID,
        "BT-9": model.get("due_date") or None,
        "BT-10": model.get("buyer_reference") or None,
        "BT-13": model.get("order_reference") or None,
        "BT-20": model.get("payment_terms") or None,
        # CII requires a delivery block; the issue date is the usual fallback.
        "BT-72": model.get("delivery_date") or model.get("issue_date") or datetime.date.today().isoformat(),
        "BT-73": model.get("period_start") or None,
        "BT-74": model.get("period_end") or None,
        "BT-83": model.get("remittance") or model.get("number") or None,
        "BT-106": str(c["line_total"]),
        "BT-109": str(c["line_total"]),
        "BT-110": str(c["tax_total"]),
        "BT-112": str(c["grand_total"]),
        "BT-113": str(c["paid"]) if c["paid"] else None,
        "BT-115": str(c["due"]),
        "BG-4": _party(model.get("seller") or {}, xrechnung, True),
        "BG-7": _party(model.get("buyer") or {}, xrechnung, False),
        "BG-23": [],
        "BG-25": [],
    }
    if xrechnung:
        data["BT-23"] = PEPPOL_PROCESS
    seller = model.get("seller") or {}
    if seller.get("iban"):
        data["BT-81"] = "58"
        data["BT-84"] = re.sub(r"\s+", "", seller["iban"]).upper()
        data["BT-85"] = seller.get("account_name") or seller.get("name") or None
        data["BT-86"] = seller.get("bic") or None
    else:
        data["BT-81"] = model.get("payment_means") or "1"
    if model.get("note"):
        data["BG-1"] = [{"BT-22": model["note"]}]
    for v in c["vat"]:
        entry = {"BT-116": str(v["base"]), "BT-117": str(v["tax"]), "BT-118": v["cat"], "BT-119": str(v["rate"])}
        if v["cat"] in ("E", "AE", "K", "G", "O"):
            entry["BT-120"] = model.get("exemption_reason") or {
                "AE": "Reverse charge", "K": "Intra-community supply", "G": "Export outside the EU",
                "E": "Exempt from VAT", "O": "Not subject to VAT"}[v["cat"]]
        if v["cat"] == "O":
            entry.pop("BT-119")
        data["BG-23"].append(entry)
    for ln in c["lines"]:
        line = {
            "BT-126": ln["id"],
            "BT-129": str(ln["qty"]),
            "BT-130": ln.get("unit") or "C62",
            "BT-131": str(ln["net"]),
            "BT-146": str(ln["price"]),
            "BT-151": ln["cat"],
            "BT-153": ln.get("name"),
            "BT-154": ln.get("description") or None,
        }
        if ln["cat"] != "O":
            line["BT-152"] = str(ln["rate"])
        data["BG-25"].append({k: v for k, v in line.items() if v not in (None, "")})
    return {k: v for k, v in data.items() if v not in (None, "", [])}


def generate_xml(model: dict, syntax: str = "cii", xrechnung: bool = False) -> bytes:
    data = to_en16931(model, xrechnung)
    if xrechnung:
        problems = [m for m in _xrechnung_input_problems(model)]
        if problems:
            raise HTTPException(400, "XRechnung needs: " + "; ".join(problems))
    try:
        if syntax == "ubl":
            xml = facturx.generate_ubl_xml(data, level="en16931", check_xsd=True, check_schematron=False)
        else:
            xml = facturx.generate_cii_xml(data, level="en16931", check_xsd=True, check_schematron=False)
    except Exception as err:
        raise HTTPException(400, f"Invoice data is incomplete: {err}") from err
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    if xrechnung:
        xml = xml.replace(f">{EN16931_ID}<".encode(), f">{XRECHNUNG_ID}<".encode(), 1)
    return xml


def _xrechnung_input_problems(model: dict):
    s, b = model.get("seller") or {}, model.get("buyer") or {}
    if not model.get("buyer_reference"):
        yield "a Buyer reference / Leitweg-ID (BT-10)"
    if not (s.get("contact_name") and s.get("phone") and s.get("email")):
        yield "seller contact name, phone and email (BR-DE-2)"
    if not (s.get("city") and s.get("postcode")):
        yield "seller postcode and city"
    if not (b.get("city") and b.get("postcode")):
        yield "buyer postcode and city"
    if not b.get("email"):
        yield "buyer email as electronic address (BT-49)"
    if not (s.get("vat_id") or s.get("tax_id")):
        yield "seller VAT ID or tax number"


def embed_zugferd(pdf_bytes: bytes, xml: bytes) -> bytes:
    try:
        return facturx.generate_from_binary(pdf_bytes, xml, flavor="factur-x", level="en16931",
                                            check_xsd=False, check_schematron=False, lang="de-DE")
    except TypeError:
        return facturx.generate_from_binary(pdf_bytes, xml, flavor="factur-x", level="en16931", check_xsd=False)
    except Exception as err:
        raise HTTPException(422, f"Could not embed the e-invoice: {err}") from err


# --------------------------------------------------------------------------- reading & validation

def extract_xml(raw: bytes, filename: str) -> tuple[bytes, str]:
    if raw[:5] == b"%PDF-" or filename.lower().endswith(".pdf"):
        try:
            name, xml = facturx.get_xml_from_pdf(raw, check_xsd=False)
        except Exception as err:
            raise HTTPException(422, f"No e-invoice XML found inside this PDF ({err}).") from err
        if not xml:
            raise HTTPException(422, "This PDF does not contain an e-invoice (no ZUGFeRD/Factur-X XML attached).")
        return xml, f"embedded {name}"
    return raw, "XML file"


def read_invoice(raw: bytes, filename: str) -> dict:
    xml, source = extract_xml(raw, filename)
    try:
        root = etree.fromstring(xml)
    except etree.XMLSyntaxError as err:
        raise HTTPException(422, f"This is not valid XML: {err}") from err
    tag = etree.QName(root).localname
    syntax = {"CrossIndustryInvoice": "UN/CEFACT CII", "Invoice": "UBL 2.1 Invoice", "CreditNote": "UBL 2.1 Credit Note"}.get(tag)
    if not syntax:
        raise HTTPException(422, f"Unknown invoice format (root element {tag}).")
    flavor = {"CrossIndustryInvoice": "factur-x", "Invoice": "ubl-2.1-invoice", "CreditNote": "ubl-2.1-creditnote"}[tag]
    try:
        data = facturx.parse_ubl_cii_xml(xml, flavor=flavor, level="autodetect",
                                         float_as="string", date_as="string", bytes_as="string", check_xsd=False)
    except Exception:
        try:
            data = facturx.parse_ubl_cii_xml(xml, flavor=flavor, level="en16931", float_as="string",
                                             date_as="string", bytes_as="string", check_xsd=False)
        except Exception as err:
            raise HTTPException(422, f"Could not read the invoice: {err}") from err
    # BT-24 as written in the file (the parser may normalise it)
    spec = root.xpath("//*[local-name()='GuidelineSpecifiedDocumentContextParameter']/*[local-name()='ID']/text()"
                      "|/*/*[local-name()='CustomizationID']/text()")
    if spec:
        data["BT-24"] = spec[0].strip()
    xsd = _xsd_check(xml, flavor, data.get("BT-24", ""))
    checks = business_rules(data)
    profile = _profile_name(data.get("BT-24", ""))
    fails = sum(1 for c in checks if c["status"] == "fail") + (0 if xsd["ok"] in (True, None) else 1)
    return {"syntax": syntax, "profile": profile, "source": source, "xsd": xsd, "checks": checks,
            "valid": fails == 0, "data": data,
            "note": "Checks the XML schema and the core EN 16931 / XRechnung business rules. "
                    "For legally binding validation use the official KoSIT validator."}


def _profile_name(bt24: str) -> str:
    if "xrechnung" in bt24:
        return "XRechnung " + bt24.rsplit("_", 1)[-1]
    if "extended" in bt24:
        return "Factur-X / ZUGFeRD EXTENDED"
    if "basicwl" in bt24:
        return "Factur-X / ZUGFeRD BASIC WL"
    if "basic" in bt24:
        return "Factur-X / ZUGFeRD BASIC"
    if "minimum" in bt24:
        return "Factur-X / ZUGFeRD MINIMUM"
    if "en16931" in bt24:
        return "EN 16931 (Factur-X / ZUGFeRD COMFORT)"
    return bt24 or "unknown"


def _xsd_check(xml: bytes, flavor: str, bt24: str) -> dict:
    level = "extended" if "extended" in bt24 else "en16931"
    for lvl in (level, "en16931", "extended"):
        try:
            facturx.xml_check_xsd(xml, flavor=flavor, level=lvl)
            return {"ok": True, "detail": f"Valid against the {flavor.upper()} {lvl} schema"}
        except Exception as err:
            last = str(err)
            if "not supported" in last.lower() or "no xsd" in last.lower():
                return {"ok": None, "detail": "Schema not available for this format"}
    return {"ok": False, "detail": last.splitlines()[-1][:400]}


def business_rules(d: dict) -> list:
    checks = []

    def rule(code, ok, title, detail=""):
        checks.append({"status": "pass" if ok else "fail", "code": code, "title": title, "detail": "" if ok else detail})

    def warn(code, title, detail=""):
        checks.append({"status": "warn", "code": code, "title": title, "detail": detail})

    seller, buyer = d.get("BG-4") or {}, d.get("BG-7") or {}
    lines = d.get("BG-25") or []
    vat = d.get("BG-23") or []
    rule("BR-01", d.get("BT-24"), "Specification identifier (BT-24) present")
    rule("BR-02", d.get("BT-1"), "Invoice number (BT-1) present")
    rule("BR-03", d.get("BT-2"), "Issue date (BT-2) present")
    rule("BR-04", d.get("BT-3"), "Invoice type code (BT-3) present")
    rule("BR-05", d.get("BT-5"), "Currency code (BT-5) present")
    rule("BR-06", seller.get("name"), "Seller name (BT-27) present")
    rule("BR-07", buyer.get("name"), "Buyer name (BT-44) present")
    rule("BR-08", seller.get("country_code"), "Seller postal address with country (BG-5)")
    rule("BR-10", buyer.get("country_code"), "Buyer postal address with country (BG-8)")
    rule("BR-16", len(lines) > 0, "At least one invoice line (BG-25)")
    for k, ln in enumerate(lines, 1):
        ok = all(ln.get(x) not in (None, "") for x in ("BT-126", "BT-129", "BT-130", "BT-131", "BT-146", "BT-153"))
        if not ok:
            rule("BR-21..26", False, f"Line {k} has id, quantity, unit, net amount, price and name",
                 "A required line field is missing.")
        else:
            expect = money(D(ln["BT-129"]) * D(ln["BT-146"]) / D(ln.get("BT-149") or 1))
            allowances = sum(D(a.get("BT-136")) for a in ln.get("BG-27") or [])
            charges = sum(D(c.get("BT-141")) for c in ln.get("BG-28") or [])
            expect = money(expect - allowances + charges)
            if abs(expect - D(ln["BT-131"])) > Decimal("0.02"):
                warn("Line calc", f"Line {k}: quantity × price = {expect}, but the line says {ln['BT-131']}")
    sum_lines = money(sum(D(ln.get("BT-131")) for ln in lines))
    if d.get("BT-106") is not None:
        rule("BR-CO-10", sum_lines == money(d["BT-106"]), "Sum of line net amounts matches BT-106",
             f"Lines add up to {sum_lines}, invoice says {d.get('BT-106')}")
    allowances = money(d.get("BT-107") or 0)
    charges = money(d.get("BT-108") or 0)
    tax_basis = money(d.get("BT-109"))
    rule("BR-CO-13", tax_basis == money(sum_lines - allowances + charges), "Total without VAT = lines − allowances + charges",
         f"Expected {money(sum_lines - allowances + charges)}, invoice says {tax_basis}")
    vat_sum = money(sum(D(v.get("BT-117")) for v in vat))
    rule("BR-CO-14", money(d.get("BT-110") or 0) == vat_sum, "Total VAT equals sum of VAT breakdown",
         f"Breakdown adds up to {vat_sum}, invoice says {d.get('BT-110')}")
    grand = money(d.get("BT-112"))
    rule("BR-CO-15", grand == tax_basis + money(d.get("BT-110") or 0), "Total with VAT = total without VAT + VAT",
         f"Expected {tax_basis + money(d.get('BT-110') or 0)}, invoice says {grand}")
    due = money(d.get("BT-115"))
    expected_due = grand - money(d.get("BT-113") or 0) + money(d.get("BT-114") or 0)
    rule("BR-CO-16", due == expected_due, "Amount due = total − paid + rounding", f"Expected {expected_due}, invoice says {due}")
    rule("BR-CO-18", len(vat) > 0, "At least one VAT breakdown group (BG-23)")
    for v in vat:
        cat = v.get("BT-118")
        if cat in ("S", "L", "M") and v.get("BT-119") is not None:
            expect = money(D(v.get("BT-116")) * D(v.get("BT-119")) / 100)
            rule("BR-S-09", abs(expect - money(v.get("BT-117"))) <= Decimal("0.01"),
                 f"VAT {cat} {v.get('BT-119')}%: tax = taxable amount × rate",
                 f"Expected {expect}, invoice says {v.get('BT-117')}")
        if cat in ("E", "AE", "K", "G", "O"):
            rule(f"BR-{cat}-10", v.get("BT-120") or v.get("BT-121"), f"VAT category {cat} has an exemption reason")
        base = money(sum(D(ln.get("BT-131")) for ln in lines if ln.get("BT-151") == cat
                         and (cat == "O" or D(ln.get("BT-152")) == D(v.get("BT-119")))))
        if lines and abs(base - money(v.get("BT-116"))) > Decimal("0.02"):
            warn(f"BR-{cat}-08", f"VAT {cat}: taxable amount matches the lines",
                 f"Lines in this category add up to {base}, breakdown says {v.get('BT-116')}")
    if seller.get("vat_identifier") is None and seller.get("tax_identifier") is None and any(v.get("BT-118") == "S" for v in vat):
        rule("BR-S-02", False, "Seller VAT ID or tax registration present for standard rated VAT",
             "Add the seller VAT identifier (BT-31) or tax number (BT-32).")
    if "xrechnung" in (d.get("BT-24") or ""):
        contact = (seller.get("contacts") or [{}])[0]
        rule("BR-DE-1", d.get("BT-81"), "Payment instructions (BG-16) present")
        rule("BR-DE-2", contact.get("name") or contact.get("phone"), "Seller contact (BG-6) present")
        rule("BR-DE-3", seller.get("city"), "Seller city (BT-37) present")
        rule("BR-DE-4", seller.get("postcode"), "Seller postcode (BT-38) present")
        rule("BR-DE-5", contact.get("name"), "Seller contact point (BT-41) present")
        rule("BR-DE-6", contact.get("phone"), "Seller contact telephone (BT-42) present")
        rule("BR-DE-7", contact.get("email"), "Seller contact email (BT-43) present")
        rule("BR-DE-8", buyer.get("city"), "Buyer city (BT-52) present")
        rule("BR-DE-9", buyer.get("postcode"), "Buyer postcode (BT-53) present")
        rule("BR-DE-15", d.get("BT-10"), "Buyer reference / Leitweg-ID (BT-10) present")
        rule("BR-DE-16", seller.get("vat_identifier") or seller.get("tax_identifier") or seller.get("tax_representative"),
             "Seller VAT ID or tax number present")
        rule("BR-DE-21", True, "Specification identifier is XRechnung")
        rule("BT-34/49", seller.get("einvoicing_addr") and buyer.get("einvoicing_addr"),
             "Seller and buyer electronic addresses (BT-34, BT-49) present")
        if d.get("BT-81") in ("58", 58):
            rule("BR-DE-19", d.get("BT-84"), "IBAN for SEPA credit transfer present")
    return checks


# --------------------------------------------------------------------------- human-readable rendering

def _fmt_money(v, cur):
    try:
        return f"{money(v):,.2f} {cur}".replace(",", " ")
    except Exception:
        return f"{v} {cur}"


def _addr(p: dict) -> str:
    rows = [p.get("name"), p.get("biz_name") if p.get("biz_name") != p.get("name") else None,
            p.get("addr_l1"), p.get("addr_l2"), " ".join(x for x in (p.get("postcode"), p.get("city")) if x),
            p.get("country_code")]
    out = "<br>".join(html.escape(str(r)) for r in rows if r)
    extra = []
    if p.get("vat_identifier"):
        extra.append(f"VAT ID: {html.escape(p['vat_identifier'])}")
    if p.get("tax_identifier"):
        extra.append(f"Tax no.: {html.escape(p['tax_identifier'])}")
    for c in p.get("contacts") or []:
        extra.append(" · ".join(html.escape(str(c[k])) for k in ("name", "phone", "email") if c.get(k)))
    if p.get("einvoicing_addr"):
        extra.append(f"E-address: {html.escape(str(p['einvoicing_addr']))}")
    if extra:
        out += "<div class='sub'>" + "<br>".join(extra) + "</div>"
    return out


def render_html(d: dict, report: dict | None = None) -> str:
    cur = d.get("BT-5", "")
    seller, buyer = d.get("BG-4") or {}, d.get("BG-7") or {}
    kind = "Credit note" if str(d.get("BT-3")) in ("381", "261", "262", "296", "308", "396", "420", "458", "532") else "Invoice"
    rows = []
    for ln in d.get("BG-25") or []:
        unit = UNITS.get(ln.get("BT-130"), ln.get("BT-130") or "")
        rate = f"{ln.get('BT-152')}%" if ln.get("BT-152") is not None else ln.get("BT-151", "")
        desc = f"<div class='sub'>{html.escape(str(ln['BT-154']))}</div>" if ln.get("BT-154") else ""
        rows.append(f"<tr><td>{html.escape(str(ln.get('BT-126', '')))}</td><td>{html.escape(str(ln.get('BT-153', '')))}{desc}</td>"
                    f"<td class='n'>{html.escape(str(ln.get('BT-129', '')))} {html.escape(unit)}</td>"
                    f"<td class='n'>{_fmt_money(ln.get('BT-146'), cur)}</td><td class='n'>{html.escape(str(rate))}</td>"
                    f"<td class='n'>{_fmt_money(ln.get('BT-131'), cur)}</td></tr>")
    vat_rows = "".join(
        f"<tr><td>{html.escape(VAT_CATEGORIES.get(v.get('BT-118'), v.get('BT-118', '')))} {html.escape(str(v.get('BT-119', '')))}"
        f"{'%' if v.get('BT-119') is not None else ''}{(' — ' + html.escape(str(v['BT-120']))) if v.get('BT-120') else ''}</td>"
        f"<td class='n'>{_fmt_money(v.get('BT-116'), cur)}</td><td class='n'>{_fmt_money(v.get('BT-117'), cur)}</td></tr>"
        for v in d.get("BG-23") or [])
    meta = [("Invoice no.", d.get("BT-1")), ("Issue date", d.get("BT-2")), ("Due date", d.get("BT-9")),
            ("Delivery date", d.get("BT-72")), ("Buyer reference", d.get("BT-10")), ("Order reference", d.get("BT-13")),
            ("Contract", d.get("BT-12")), ("Project", d.get("BT-11"))]
    meta_html = "".join(f"<tr><th>{k}</th><td>{html.escape(str(v))}</td></tr>" for k, v in meta if v)
    totals = [("Sum of lines", d.get("BT-106")), ("Allowances", d.get("BT-107")), ("Charges", d.get("BT-108")),
              ("Total without VAT", d.get("BT-109")), ("VAT", d.get("BT-110")), ("Total with VAT", d.get("BT-112")),
              ("Paid", d.get("BT-113")), ("Rounding", d.get("BT-114"))]
    totals_html = "".join(f"<tr><th>{k}</th><td class='n'>{_fmt_money(v, cur)}</td></tr>" for k, v in totals if v not in (None, ""))
    pay = []
    if d.get("BT-84"):
        pay.append(f"IBAN: {html.escape(str(d['BT-84']))}")
    if d.get("BT-86"):
        pay.append(f"BIC: {html.escape(str(d['BT-86']))}")
    if d.get("BT-85"):
        pay.append(f"Account holder: {html.escape(str(d['BT-85']))}")
    if d.get("BT-83"):
        pay.append(f"Reference: {html.escape(str(d['BT-83']))}")
    if d.get("BT-20"):
        pay.append(html.escape(str(d["BT-20"])))
    notes = "".join(f"<p>{html.escape(str(n.get('BT-22', '')))}</p>" for n in d.get("BG-1") or [])
    badge = ""
    if report:
        ok = report.get("valid")
        badge = f"<div class='badge {'ok' if ok else 'bad'}'>{'✓ Valid' if ok else '✗ Problems found'} · {html.escape(report.get('profile', ''))}</div>"
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{kind} {html.escape(str(d.get('BT-1', '')))}</title>
<style>
@page {{ size: A4; margin: 16mm 16mm 18mm; }}
body {{ font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 9.5pt; color: #222; }}
h1 {{ font-size: 20pt; margin: 0 0 4mm; color: #c2185b; }}
.top {{ display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 8mm; }}
.box h3 {{ font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 0 0 1mm; }}
.sub {{ color: #666; font-size: 8.5pt; margin-top: 1mm; }}
table {{ border-collapse: collapse; width: 100%; }}
.lines th {{ background: #fde4ee; text-align: left; padding: 2mm; font-size: 8.5pt; }}
.lines td {{ padding: 2mm; border-bottom: 1px solid #eee; vertical-align: top; }}
.n {{ text-align: right; white-space: nowrap; }}
.meta th {{ text-align: left; color: #888; font-weight: normal; padding: .5mm 4mm .5mm 0; }}
.sum {{ width: 85mm; margin-left: auto; margin-top: 5mm; }}
.sum th {{ text-align: left; font-weight: normal; padding: 1mm 0; }}
.sum tr:last-child th, .sum tr:last-child td {{ font-weight: bold; border-top: 2px solid #c2185b; font-size: 11pt; padding-top: 2mm; }}
.vat {{ width: 120mm; margin-top: 6mm; }} .vat td, .vat th {{ padding: 1mm 2mm; border-bottom: 1px solid #eee; text-align: left; }}
.badge {{ display: inline-block; padding: 1.5mm 3mm; border-radius: 3mm; font-weight: bold; margin-bottom: 4mm; }}
.badge.ok {{ background: #e3f7ec; color: #1b7a4b; }} .badge.bad {{ background: #fde4e4; color: #b3261e; }}
.foot {{ margin-top: 8mm; color: #555; }}
</style></head><body>
{badge}
<h1>{kind}</h1>
<div class="top">
  <div class="box"><h3>From</h3>{_addr(seller)}</div>
  <div class="box"><h3>To</h3>{_addr(buyer)}</div>
  <div class="box"><table class="meta">{meta_html}</table></div>
</div>
<table class="lines"><thead><tr><th>#</th><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">VAT</th><th class="n">Amount</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<table class="sum">{totals_html}<tr><th>Amount due</th><td class="n">{_fmt_money(d.get('BT-115'), cur)}</td></tr></table>
<table class="vat"><thead><tr><th>VAT breakdown</th><th>Taxable</th><th>VAT</th></tr></thead><tbody>{vat_rows}</tbody></table>
<div class="foot">{'<br>'.join(pay)}{notes}</div>
</body></html>"""


def guess_from_text(text: str) -> dict:
    """Very small heuristic to prefill the 'PDF invoice to e-invoice' form."""
    out = {}
    m = re.search(r"(?:invoice|rechnung|factuur|facture)\s*(?:no\.?|nr\.?|number|nummer|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,})", text, re.I)
    if m:
        out["number"] = m.group(1)
    m = re.search(r"(\d{4}-\d{2}-\d{2})|(\d{1,2})[./](\d{1,2})[./](\d{4})", text)
    if m:
        out["issue_date"] = m.group(1) or f"{m.group(4)}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"
    m = re.search(r"\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b", text)
    if m:
        out["iban"] = m.group(1)
    m = re.search(r"\b((?:DE|NL|AT|FR|BE|IT|ES|BG)[0-9A-Z]{8,12})\b", text)
    if m:
        out["vat_id"] = m.group(1)
    return out
