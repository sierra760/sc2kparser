const fs = require('fs');
const { createCanvas } = require('canvas');
const sc2kparser = require('./sc2kparser');

// Get city file from command line or use default
const cityFile = process.argv[2] || 'samples/Aliso Niguel.sc2';
console.log(`Loading city file: ${cityFile}`);

// Parse the city
const bytes = fs.readFileSync(cityFile);
const cityData = sc2kparser.parse(bytes);

console.log(`Creating maps for: ${cityData.cityName || 'Unknown City'}`);
console.log(`Population: ${cityData.population || 0}`);
console.log(`Founded: ${cityData.founded || 'Unknown'}`);
console.log(`Multi-tile buildings found: ${cityData.multiTileBuildings.length}`);

// Zone colors with proper light/dense differentiation
const zoneColors = {
    0: '#FFFFFF', // None
    1: '#90EE90', // Light residential (light green)
    2: '#228B22', // Dense residential (forest green)
    3: '#87CEEB', // Light commercial (sky blue)  
    4: '#0000CD', // Dense commercial (medium blue)
    5: '#FFFF99', // Light industrial (light yellow)
    6: '#FFD700', // Dense industrial (gold)
    7: '#DDA0DD', // Military (plum)
    8: '#FFE4B5', // Airport (moccasin)
    9: '#B0C4DE'  // Seaport (light steel blue)
};

// Building colors by type
const buildingColors = {
    'residential_1x1': '#006400',
    'residential_2x2': '#006400',
    'residential_3x3': '#006400',
    'commercial_1x1': '#00008B',
    'commercial_2x2': '#00008B',
    'commercial_3x3': '#00008B',
    'industrial_1x1': '#8B8B00',
    'industrial_2x2': '#8B8B00',
    'industrial_3x3': '#8B8B00',
    'powerplant_4x4': '#8B0000',
    'civic': '#800080',
    'arcology_4x4': '#4B0082',
    'other': '#696969'
};

// Create heightmap with water
function createHeightmap() {
    const canvas = createCanvas(512, 512); // 128x4 = 512 pixels
    const ctx = canvas.getContext('2d');
    
    // Find altitude range
    let minAlt = 9999;
    let maxAlt = 0;
    cityData.tiles.forEach(tile => {
        if (!tile.water && tile.alt !== undefined) {
            minAlt = Math.min(minAlt, tile.alt);
            maxAlt = Math.max(maxAlt, tile.alt);
        }
    });
    
    // Calculate water level in feet
    // The global water level is on a 0-31 scale
    // Using formula: (value * 100) + 50
    const waterLevelFeet = (cityData.waterLevel * 100) + 50;
    console.log(`\nWater level: ${cityData.waterLevel} (${waterLevelFeet} feet)`);
    console.log(`Altitude range: ${minAlt} to ${maxAlt} feet`);
    
    // Draw tiles (with Y-axis flip)
    for (let i = 0; i < 16384; i++) {
        const x = i % 128;
        const y = Math.floor(i / 128);
        const flippedY = 127 - y; // Flip Y-axis
        const tile = cityData.tiles[i];
        
        // Use XTER water level for accurate water detection
        const xterWaterLevel = tile.terrain?.waterlevel;
        const isWater = xterWaterLevel === 'submerged' || 
                        xterWaterLevel === 'shore' || 
                        xterWaterLevel === 'surface' ||
                        xterWaterLevel === 'waterfall';
        
        if (isWater) {
            // Different shades of blue for different water types
            switch(xterWaterLevel) {
                case 'submerged':
                    ctx.fillStyle = '#004080'; // Dark blue for deep water
                    break;
                case 'shore':
                    ctx.fillStyle = '#0066CC'; // Medium blue for shore
                    break;
                case 'surface':
                    ctx.fillStyle = '#0099FF'; // Light blue for surface
                    break;
                case 'waterfall':
                    ctx.fillStyle = '#00CCFF'; // Cyan for waterfall
                    break;
                default:
                    ctx.fillStyle = '#0066CC'; // Default blue
            }
        } else {
            // Green gradient for land
            const normalized = (tile.alt - minAlt) / (maxAlt - minAlt);
            const green = Math.floor(100 + normalized * 155);
            ctx.fillStyle = `rgb(0, ${green}, 0)`;
        }
        
        ctx.fillRect(x * 4, flippedY * 4, 4, 4);
    }
    
    // Save heightmap
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync('output/heightmap.png', buffer);
    console.log('Created: output/heightmap.png');
}

// Create building/zone map using parser data
function createBuildingMap() {
    const canvas = createCanvas(2048, 2048); // 128x16 = 2048 pixels
    const ctx = canvas.getContext('2d');
    const tileSize = 16;
    
    // Background
    ctx.fillStyle = '#F0F0F0';
    ctx.fillRect(0, 0, 2048, 2048);
    
    // Draw zones first (with Y-axis flip)
    for (let i = 0; i < 16384; i++) {
        const x = i % 128;
        const y = Math.floor(i / 128);
        const flippedY = 127 - y; // Flip Y-axis
        const tile = cityData.tiles[i];
        
        if (tile.zone && tile.zone.type > 0) {
            ctx.fillStyle = zoneColors[tile.zone.type] || '#CCCCCC';
            ctx.fillRect(x * tileSize, flippedY * tileSize, tileSize, tileSize);
        }
    }
    
    // Draw buildings/infrastructure
    const drawnTiles = new Set();
    
    for (let i = 0; i < 16384; i++) {
        const x = i % 128;
        const y = Math.floor(i / 128);
        const flippedY = 127 - y; // Flip Y-axis
        const tile = cityData.tiles[i];
        
        if (tile.building && tile.building !== 0 && !drawnTiles.has(i)) {
            const px = x * tileSize;
            const py = flippedY * tileSize;
            const hex = tile.building.toString(16).toUpperCase().padStart(2, '0');
            
            // Handle based on building type from parser
            switch(tile.buildingType) {
                case 'tree':
                    const density = (tile.building - 0x06) / 6; // 0 to 1
                    const green = Math.floor(34 + density * 60); // From dark to lighter green
                    ctx.fillStyle = `rgb(0, ${green}, 0)`;
                    ctx.beginPath();
                    ctx.arc(px + tileSize/2, py + tileSize/2, tileSize/3 + density * 2, 0, 2 * Math.PI);
                    ctx.fill();
                    break;
                    
                case 'powerline':
                    ctx.strokeStyle = '#FFD700';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(px + tileSize/2, py);
                    ctx.lineTo(px + tileSize/2, py + tileSize);
                    ctx.moveTo(px, py + tileSize/2);
                    ctx.lineTo(px + tileSize, py + tileSize/2);
                    ctx.stroke();
                    break;
                    
                case 'road':
                    ctx.fillStyle = '#505050';
                    ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
                    break;
                    
                case 'rail':
                    ctx.fillStyle = '#8B7355';
                    ctx.fillRect(px + 2, py + 2, tileSize - 4, tileSize - 4);
                    break;
                    
                case 'tunnel':
                    ctx.fillStyle = '#2F4F4F';
                    ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
                    ctx.fillStyle = '#000000';
                    ctx.beginPath();
                    ctx.arc(px + tileSize/2, py + tileSize/2, tileSize/3, 0, 2 * Math.PI);
                    ctx.fill();
                    break;
                    
                case 'highway':
                    ctx.fillStyle = '#303030';
                    ctx.fillRect(px, py, tileSize, tileSize);
                    break;
                    
                default:
                    // Check if this is part of a multi-tile building
                    if (tile.multiTileBuilding) {
                        const mtb = tile.multiTileBuilding;
                        
                        // Only draw from the top-left corner
                        if (x === mtb.topLeftX && y === mtb.topLeftY) {
                            const bgColor = buildingColors[tile.buildingType] || '#696969';
                            
                            // Calculate display position for multi-tile building
                            const topY = 127 - (mtb.topLeftY + mtb.height - 1);
                            
                            // Draw building fill
                            ctx.fillStyle = bgColor;
                            ctx.globalAlpha = 0.3;
                            ctx.fillRect(mtb.topLeftX * tileSize + 2, topY * tileSize + 2, 
                                       mtb.width * tileSize - 4, mtb.height * tileSize - 4);
                            ctx.globalAlpha = 1.0;
                            
                            // Draw building outline
                            ctx.strokeStyle = bgColor;
                            ctx.lineWidth = 2;
                            ctx.strokeRect(mtb.topLeftX * tileSize + 1, topY * tileSize + 1, 
                                         mtb.width * tileSize - 2, mtb.height * tileSize - 2);
                            
                            // Draw building code in center
                            ctx.fillStyle = bgColor;
                            ctx.font = 'bold 12px monospace';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            const centerX = mtb.topLeftX * tileSize + (mtb.width * tileSize) / 2;
                            const centerY = topY * tileSize + (mtb.height * tileSize) / 2;
                            ctx.fillText(`${hex} (${mtb.width}x${mtb.height})`, centerX, centerY);
                            
                            // Mark all tiles as drawn
                            for (let dy = 0; dy < mtb.height; dy++) {
                                for (let dx = 0; dx < mtb.width; dx++) {
                                    drawnTiles.add((mtb.topLeftY + dy) * 128 + mtb.topLeftX + dx);
                                }
                            }
                        }
                    } else {
                        // Single tile building
                        const bgColor = buildingColors[tile.buildingType] || '#696969';
                        ctx.fillStyle = bgColor;
                        ctx.font = '10px monospace';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(hex, px + tileSize/2, py + tileSize/2);
                        drawnTiles.add(i);
                    }
                    break;
            }
        }
    }
    
    // Draw grid lines
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    for (let x = 0; x <= 128; x++) {
        ctx.beginPath();
        ctx.moveTo(x * tileSize, 0);
        ctx.lineTo(x * tileSize, 2048);
        ctx.stroke();
    }
    for (let y = 0; y <= 128; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * tileSize);
        ctx.lineTo(2048, y * tileSize);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    
    // Add legend
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(20, 1900, 400, 120);
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(20, 1900, 400, 120);
    
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.fillText('Zone Colors (background):', 30, 1920);
    
    ctx.font = '10px Arial';
    ctx.fillText('Light/Dense Res: Light/Forest Green', 30, 1940);
    ctx.fillText('Light/Dense Com: Sky/Medium Blue', 30, 1955);
    ctx.fillText('Light/Dense Ind: Light Yellow/Gold', 30, 1970);
    ctx.fillText('Multi-tile buildings outlined with size', 30, 1990);
    ctx.fillText('All parsing done by sc2kparser.js', 30, 2005);
    
    // Save building map
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync('output/buildings.png', buffer);
    console.log('Created: output/buildings.png');
}

// Show some statistics from the parser
console.log('\nZone statistics:');
const zoneCounts = {};
cityData.tiles.forEach(tile => {
    if (tile.zone && tile.zone.type !== undefined) {
        const typeName = tile.zone.typeName || `type_${tile.zone.type}`;
        zoneCounts[typeName] = (zoneCounts[typeName] || 0) + 1;
    }
});
Object.entries(zoneCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} tiles`);
});

console.log('\nBuilding type statistics:');
const buildingTypeCounts = {};
cityData.tiles.forEach(tile => {
    if (tile.buildingType) {
        buildingTypeCounts[tile.buildingType] = (buildingTypeCounts[tile.buildingType] || 0) + 1;
    }
});
Object.entries(buildingTypeCounts).sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} tiles`);
});

// Create the maps
createHeightmap();
createBuildingMap();