const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise, Builder } = require('xml2js');
const fs = require('fs');
const { execSync } = require('child_process');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlUrl = "https://raw.githubusercontent.com/jurko22/xml-import/main/feed.xml";
const xmlFilePath = './feed.xml';

async function importXMLFeed() {
    try {
        console.log("🚀 Fetching XML feed...");
        const response = await fetch(xmlUrl);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const xmlContent = await response.text();
        const parsedData = await parseStringPromise(xmlContent);
        const items = parsedData.SHOP.SHOPITEM || [];

        const products = items.map((item) => ({
            id: item.$.id ? parseInt(item.$.id, 10) : null,
            name: item.NAME?.[0] || "Unknown",
            image_url: item.IMAGES?.[0]?.IMAGE?.[0]?._ || null,
            sizes: (item.VARIANTS?.[0]?.VARIANT || []).map(variant => ({
                size: variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown"
            }))
        }));

        if (products.length === 0) {
            console.log("❌ No products found in XML feed.");
            return;
        }

        console.log("📡 Fetching updated product prices and statuses from Supabase...");
        const { data: productPrices, error: priceFetchError } = await supabase
            .from('product_price_view')
            .select('product_id, size, final_price, final_status');

        if (priceFetchError) {
            console.error("❌ Error fetching product prices:", priceFetchError);
            return;
        }

        const priceMap = new Map(productPrices.map(p => [`${p.product_id}-${p.size}`, { price: p.final_price, status: p.final_status }]));

        console.log("🛠 Updating XML feed...");
        const updatedItems = products.map(product => {
            let hasExpresne = false;

            const variants = product.sizes.map(variant => {
                const key = `${product.id}-${variant.size}`;
                const priceData = priceMap.get(key) || { price: 0, status: "Neznámy" };

                console.log(`🛠 ${product.id} - ${variant.size} → Cena: ${priceData.price}, Status: ${priceData.status}`);

                if (priceData.status === "SKLADOM EXPRES") hasExpresne = true;

                return {
                    PARAMETERS: [{ PARAMETER: [{ VALUE: [variant.size] }] }],
                    PRICE_VAT: [(priceData.price ?? 0).toString()], // Ak je null, nastaví sa 0
                    AVAILABILITY_OUT_OF_STOCK: [priceData.status]
                };
            });

            const flags = [
                { CODE: "expresne-odoslanie", ACTIVE: hasExpresne ? "1" : "0" }
            ];

            return {
                $: { id: product.id },
                NAME: [product.name],
                IMAGES: [{ IMAGE: [product.image_url] }],
                VARIANTS: [{ VARIANT: variants }],
                FLAGS: [{ FLAG: flags.map(flag => ({ CODE: flag.CODE, ACTIVE: flag.ACTIVE })) }]
            };
        });

        const builder = new Builder();
        const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: updatedItems } });

        // Porovnanie, či sa zmenil obsah XML
        if (fs.existsSync(xmlFilePath)) {
            const existingXml = fs.readFileSync(xmlFilePath, 'utf8');
            if (existingXml === updatedXml) {
                console.log("✅ No changes in XML feed, skipping commit.");
                return;
            }
        }

        fs.writeFileSync(xmlFilePath, updatedXml);
        console.log("✅ XML Feed updated!");

        // 🛠 Commit a push XML na GitHub
        console.log("🚀 Committing and pushing XML feed to GitHub...");
        execSync("git config --global user.name 'GitHub Actions'");
        execSync("git config --global user.email 'actions@github.com'");
        execSync("git add feed.xml");
        execSync('git commit -m "🔄 Auto-update XML feed" || echo "No changes to commit"');
        execSync("git push https://${{ secrets.GITHUB_TOKEN }}@github.com/jurko22/xml-import.git main");

        console.log("✅ XML feed successfully pushed to GitHub!");
    } catch (error) {
        console.error("❌ Error importing XML feed:", error);
    }
}

importXMLFeed();
