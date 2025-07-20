# SimCity 2000 Save File Parser

A Node.js library for parsing SimCity 2000 save files (.sc2) with enhanced support for Mac/DOS format files.

## Features

- Complete parsing of SimCity 2000 save file segments
- Proper handling of Mac/DOS vs Windows 95 format differences
- Altitude parsing using correct formula: (value × 100) + 50 feet
- Accurate water detection using XTER terrain data
- Zone type detection (residential, commercial, industrial, etc.)
- Multi-tile building detection with size analysis
- Building type identification (civic, power plants, arcologies, etc.)
- Visualization tools for creating city maps

## Installation

```bash
npm install sc2kparser
```

## Usage

### Basic Parsing

```javascript
const fs = require('fs');
const sc2kparser = require('sc2kparser');

// Read file
const bytes = fs.readFileSync('city.sc2');

// Parse
const cityData = sc2kparser.parse(bytes);

console.log(`City: ${cityData.cityName}`);
console.log(`Population: ${cityData.population}`);
console.log(`Founded: ${cityData.founded}`);
```

### Browser Usage

```javascript
document.body.addEventListener('dragover', function(event) {
  event.preventDefault();
  event.stopPropagation();
}, false);

document.body.addEventListener('drop', function(event) {
  event.preventDefault();
  event.stopPropagation();

  let file = event.dataTransfer.files[0];
  let fileReader = new FileReader();
  fileReader.onload = function(e) {
    let bytes = new Uint8Array(e.target.result);
    let struct = sc2kparser.parse(bytes);
    console.log(struct);
  };
  fileReader.readAsArrayBuffer(file);
}, false);
```

### Visualization Tool

Generate heightmap and building/zone maps:

```bash
node visualize_city.js "samples/Aliso Niguel.sc2"
```

This creates two images in the `output/` directory:
- `heightmap.png` - Topographical map with water features
- `buildings.png` - Detailed map showing zones, buildings, and infrastructure

## Data Structure

The parser returns a comprehensive data structure:

```javascript
{
  cityName: string,
  population: number,
  founded: number,
  cityAge: number,
  money: number,
  waterLevel: number,        // Global sea level (0-31 scale)
  
  tiles: [                   // 128x128 array of tiles
    {
      // Altitude and water
      alt: number,           // Altitude in feet ((0-31) * 100 + 50)
      water: boolean,        // ALTM water flag
      
      // Terrain from XTER
      terrain: {
        slope: [0,0,0,0],    // Corner heights
        waterlevel: string,  // 'dry'/'submerged'/'shore'/'surface'/'waterfall'
      },
      
      // Zone information
      zone: {
        type: number,        // 0-9 zone type
        typeName: string,    // e.g., 'light_residential'
        topLeft: boolean,    // Multi-tile zone corners
        bottomLeft: boolean,
        bottomRight: boolean,
        topRight: boolean
      },
      
      // Building information
      building: number,      // Building code (0x00-0xFF)
      buildingName: string,  // From buildingNames.json
      buildingType: string,  // Category (e.g., 'residential_2x2')
      buildingSize: number,  // 1-4 for square buildings
      
      // Multi-tile building reference
      multiTileBuilding: {
        topLeftX: number,
        topLeftY: number,
        width: number,
        height: number
      },
      
      // Infrastructure
      powerable: boolean,
      powered: boolean,
      piped: boolean,
      watered: boolean,
      
      // Underground
      underground: {
        subway: boolean,
        pipes: boolean,
        missileSilo: boolean,
        subwayStation: boolean
      }
    }
  ],
  
  // Multi-tile buildings array
  multiTileBuildings: [{
    x: number,
    y: number,
    width: number,
    height: number,
    building: number,
    buildingName: string
  }],
  
  // City statistics
  residentialPopulation: number,
  commercialPopulation: number,
  industrialPopulation: number,
  residentialDemand: number,
  commercialDemand: number,
  industrialDemand: number,
  
  // And many more city attributes...
}
```

## File Format Notes

This parser properly handles Mac/DOS format SC2 files:

- **XZON** (zones): Zone type in bits 0-3, corner bits in bits 4-7
- **ALTM** (altitude): Bits 0-4 for altitude steps, bit 7 for water flag
- **XTER** (terrain): Provides accurate water placement via waterlevel field
- **MISC**: Contains global settings including water level at offset 0xE40

## Project Files

- `sc2kparser.js` - Main parser library
- `visualize_city.js` - Visualization tool for creating city maps
- `buildingNames.json` - Building code to name mappings
- `docs/` - File format documentation
- `samples/` - Example city files
- `output/` - Generated visualizations

## License

ISC

## Acknowledgments

Thanks to David Moews for his documentation of the file format (simcity-2000-info.txt) and the SimCity 2000 community for additional format documentation.