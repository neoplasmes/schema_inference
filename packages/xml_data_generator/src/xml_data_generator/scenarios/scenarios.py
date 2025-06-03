from dataclasses import dataclass


@dataclass(frozen=True)
class Field:
    role: str
    names: tuple[str, ...]
    value: str = ""
    children: tuple["Field", ...] = ()
    optional: bool = False
    repeated: bool = False


def address(role: str, names: tuple[str, ...]) -> Field:
    """Describe distinct address roles with deliberately identical child shapes."""
    return Field(
        role,
        names,
        children=(
            Field(f"{role}.street", ("streetname", "roadname", "street"), "Oak Road"),
            Field(f"{role}.city", ("cityname", "townname", "city"), "York"),
            Field(f"{role}.postal", ("postalcode", "zipcode", "postcode"), "00123"),
        ),
    )


SCENARIOS = {
    "orders": Field(
        "order",
        ("purchaseorder", "salerequest", "orderrecord"),
        children=(
            Field("order.id", ("orderidentifier", "purchaseid", "ordid"), "000042"),
            Field("order.customer", ("customername", "buyername", "clientname"), "Ada"),
            address(
                "order.billing", ("customerbillingaddress", "clientinvoiceaddress")
            ),
            address(
                "order.shipping", ("customershippingaddress", "buyerdeliveryaddress")
            ),
            Field(
                "order.line",
                ("orderline", "purchaseitem", "lineitem"),
                repeated=True,
                children=(
                    Field(
                        "order.line.sku", ("productcode", "itemidentifier", "sku"), "A7"
                    ),
                    Field("order.line.quantity", ("quantity", "itemcount", "qty"), "2"),
                    Field(
                        "order.line.price", ("unitprice", "itemcost", "price"), "19.95"
                    ),
                ),
            ),
            Field(
                "order.note",
                ("customernote", "buyerremark", "memo"),
                "Urgent",
                optional=True,
            ),
        ),
    ),
    "invoices": Field(
        "invoice",
        ("invoice", "billingstatement", "paymentrequest"),
        children=(
            Field("invoice.id", ("invoiceidentifier", "statementid", "invid"), "INV-4"),
            Field(
                "invoice.date", ("issuedate", "creationdate", "issued"), "2025-04-30"
            ),
            Field("invoice.amount", ("totalamount", "amountdue", "balance"), "39.90"),
            Field(
                "invoice.payer",
                ("payer", "remitter", "paymentoriginator"),
                children=(
                    Field("invoice.payer.name", ("name", "fullname"), "Ada"),
                    Field(
                        "invoice.payer.account", ("accountnumber", "accountid"), "0011"
                    ),
                ),
            ),
            Field(
                "invoice.payee",
                ("payee", "beneficiary", "paymentrecipient"),
                children=(
                    Field("invoice.payee.name", ("name", "fullname"), "Lin"),
                    Field(
                        "invoice.payee.account", ("accountnumber", "accountid"), "0022"
                    ),
                ),
            ),
        ),
    ),
    "catalog": Field(
        "catalog",
        ("productcatalog", "inventorylist", "merchandiseregister"),
        children=(
            Field(
                "catalog.item",
                ("product", "article", "inventoryitem"),
                repeated=True,
                children=(
                    Field("catalog.item.id", ("productid", "stockcode", "sku"), "0007"),
                    Field(
                        "catalog.item.name",
                        ("productname", "articletitle", "label"),
                        "Lamp",
                    ),
                    Field(
                        "catalog.item.price",
                        ("retailprice", "sellingprice", "cost"),
                        "8.50",
                    ),
                    Field(
                        "catalog.item.maker",
                        ("manufacturer", "producer", "maker"),
                        "Acme",
                        optional=True,
                    ),
                ),
            ),
        ),
    ),
    "contacts": Field(
        "directory",
        ("contactdirectory", "addressbook", "personregister"),
        children=(
            Field(
                "directory.person",
                ("person", "contact", "individual"),
                repeated=True,
                children=(
                    Field(
                        "directory.person.name",
                        ("fullname", "personname", "displayname"),
                        "Ada Lovelace",
                    ),
                    Field(
                        "directory.person.email",
                        ("emailaddress", "electronicmail", "email"),
                        "ada@example.test",
                    ),
                    Field(
                        "directory.person.phone",
                        ("telephonenumber", "phonenumber", "telno"),
                        "+44123456",
                        optional=True,
                    ),
                    address(
                        "directory.person.home", ("homeaddress", "residentialaddress")
                    ),
                ),
            ),
        ),
    ),
}

FORBIDDEN_ROLE_PAIRS = (
    ("order.billing", "order.shipping"),
    ("invoice.payer", "invoice.payee"),
    ("invoice.id", "invoice.payer.account"),
    ("catalog.item.id", "catalog.item.price"),
)
