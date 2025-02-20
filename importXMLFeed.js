const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise, Builder } = require('xml2js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlFilePath = './feed.xml';  // Lokálny XML súbor na prepisovanie
const xmlUrl = "https://raw.githubusercontent.com/jurajorlicky/xml-import/main/feed.xml";

async function fetchAndProcessXML() {
    try {
        console.log("🚀 Fetching latest XML feed...");
        const response = await fetch(xmlUrl, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const xmlContent = await response.text();

        console.log("🔍 Parsing XML...");
        const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
        const items = parsedData.SHOP.SHOPITEM || [];

        console.log(`📊 Total products in XML: ${items.length}`);

        console.log("📡 Fetching product data from Supabase...");
        const { data: existingProducts, error: fetchError } = await supabase
            .from('products')
            .select('id, original_price');

        if (fetchError) {
            console.error("❌ Error fetching existing products:", fetchError);
            return;
        }

        const existingProductIds = new Set(existingProducts.map(p => p.id));

        let newProducts = [];
        let newSizes = [];
        let updates = [];

        console.log("🛠 Processing products...");
        for (const item of items) {
            const productId = item.$.id;
            const name = item.NAME?.[0] || "Unknown";
            const manufacturer = item.MANUFACTURER?.[0] || "Unknown";

            if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) continue;

            let productExists = existingProductIds.has(productId);
            if (!productExists) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name, manufacturer });
            }

            for (const variant of item.VARIANTS[0].VARIANT) {
                const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                const priceVat = parseFloat(variant.PRICE_VAT?.[0]) || null;
                const stockStatus = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Unknown";

                const { data: existingSize, error: sizeError } = await supabase
                    .from('product_sizes')
                    .select('id, price, stock_status')
                    .eq('product_id', productId)
                    .eq('size', size)
                    .single();

                if (sizeError && sizeError.code !== 'PGRST116') {
                    console.error("❌ Database error:", sizeError);
                    continue;
                }

                if (!existingSize) {
                    console.log(`🆕 Adding new size: ${size} for product ${productId}`);
                    newSizes.push({ product_id: productId, size, price: priceVat, stock_status: stockStatus });
                } else if (existingSize.price !== priceVat || existingSize.stock_status !== stockStatus) {
                    console.log(`🔄 Updating size: ${size} for product ${productId}`);
                    updates.push({ id: existingSize.id, price: priceVat, stock_status: stockStatus });
                }
            }
        }

        if (newProducts.length > 0) {
            const { error: insertError } = await supabase.from('products').insert(newProducts);
            if (insertError) console.error("❌ Error inserting products:", insertError);
            else console.log(`✅ Inserted ${newProducts.length} new products.`);
        }

        if (newSizes.length > 0) {
            const { error: insertSizeError } = await supabase.from('product_sizes').insert(newSizes);
            if (insertSizeError) console.error("❌ Error inserting sizes:", insertSizeError);
            else console.log(`✅ Inserted ${newSizes.length} new sizes.`);
        }

        for (const update of updates) {
            const { error: updateError } = await supabase
                .from('product_sizes')
                .update({ price: update.price, stock_status: update.stock_status })
                .eq('id', update.id);

            if (updateError) console.error("❌ Error updating product size:", updateError);
        }

        console.log("✅ All updates finished.");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

async function updateXMLPrices() {
    try {
        console.log("🚀 Fetching latest XML feed...");
        const response = await fetch(xmlUrl, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const xmlContent = await response.text();

        console.log("🔍 Parsing XML...");
        const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
        const items = parsedData.SHOP.SHOPITEM || [];

        console.log("📡 Fetching updated product prices from Supabase...");
        const { data: updatedProducts, error: fetchError } = await supabase
            .from('product_price_view')
            .select('product_id, size, final_price, final_status');

        if (fetchError) {
            console.error("❌ Error fetching product prices:", fetchError);
            return;
        }

        const priceMap = new Map(
            updatedProducts.map(p => [`${p.product_id}-${p.size}`, { price: p.final_price, status: p.final_status }])
        );

        console.log("🛠 Updating XML prices and stock status...");
        let changesMade = false;

        for (const item of items) {
            if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) continue;

            for (const variant of item.VARIANTS[0].VARIANT) {
                let size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                const key = `${item.$.id}-${size}`;
                const priceData = priceMap.get(key);

                if (!priceData) continue;

                let updated = false;

                if (priceData.price !== null && variant.PRICE_VAT?.[0] !== priceData.price.toString()) {
                    variant.PRICE_VAT[0] = priceData.price.toString();
                    updated = true;
                }

                if (priceData.status !== null && variant.AVAILABILITY_OUT_OF_STOCK?.[0] !== priceData.status) {
                    variant.AVAILABILITY_OUT_OF_STOCK[0] = priceData.status;
                    updated = true;
                }

                if (updated) changesMade = true;
            }
        }

        if (!changesMade) {
            console.log("✅ No changes detected in XML, skipping update.");
            return;
        }

        console.log("📄 Writing updated XML feed...");
        const builder = new Builder({ headless: true, renderOpts: { pretty: true } });
        const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: items } });

        fs.writeFileSync(xmlFilePath, updatedXml);
        console.log("✅ XML Feed successfully updated!");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

async function main() {
    await fetchAndProcessXML();  // Najskôr načítanie do databázy
    await updateXMLPrices();  // Potom aktualizácia XML feedu
}

main();
