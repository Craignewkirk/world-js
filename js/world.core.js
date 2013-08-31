/*!
 * world.core.js
 * Define a world and manage its main loop.
 *
 * World JS: Evolution Simulator
 * https://github.com/anvoz/world-js
 * Copyright (c) 2013 An Vo - anvo4888@gmail.com
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 */

(function(window, undefined) {
    'use strict';

    var
        // Localise globals
        document = window.document,
        requestAnimationFrame = (function() {
            // Use requestAnimationFrame for better animation
            return (
                window.requestAnimationFrame       ||
                window.webkitRequestAnimationFrame ||
                window.mozRequestAnimationFrame    ||
                window.oRequestAnimationFrame      ||
                window.msRequestAnimationFrame     ||
                function(callback, element) {
                    window.setTimeout(function() {
                        callback(+new Date)
                    }, 1000 / 60);
                }
            );
        })();

    /**
     * WorldJS constructor
     * Define default properties of a world
     */
    var WorldJS = window.WorldJS = function() {
        // The value of this refers to a newly created world
        var world = this;

        // The world is currently not running
        world.running = false;
        // Trigger once after the world animation was stopped
        world.stopCallback = function() {};

        // Size of the world in pixels
        world.width = 640;
        world.height = 360;
        // Prevent objects from drawing outside the world
        world.padding = 10; // 10 pixels from border

        world.canvas = {
            wrapper: false, // DOM element that wraps the canvas
            context: false  // HTML5 drawing context
        };
        world.sprite = {
            src: 'images/seeds.png',
            image: false    // DOM image object of sprite
        };

        // World contains seeds
        // Each seed has an unique id
        world.nextSeedId = 1;

        // Don't draw every frame (tick) if total seeds > this value
        world.maxSafeSeedsForDisplay = 30000;

        // Used for calculating age of a seed
        world.tickPerYear = 60;

        /*
         * Used for indicating a year, +1 every frame (tick)
         * Example: tickPerYear = 60
         * tickMod: 0   60  120 180 ...
         * year:    0   1   2   3   ...
         */
        world.tickMod = 0;

        /*
         * Seeds don't trigger their main actions every frame
         * Example: In 60 frames, a male only seeks for female twice (in 30th frame and 60th frame)
         * To make it's more efficient, main actions of all seeds will be distributed in all frames
         * Example: male_1 will seek for female in 30th frame, 60th frame...
         *          male_2 will seek for female in 31th frame, 61th frame...
         *
         * distributedTicks property has its length equals <tickPerYear - 1> which means:
         * In every <tickPerYear> frames
         * <tickPerYear - 1> frames are used to trigger main actions of seeds
         * Last frame is used for other calculations such as statistic, user interface update...
         */
        world.distributedTicks = [];
        for (var i = 0; i < world.tickPerYear - 1; i++) {
            world.distributedTicks.push(0);
        }

        // Used for calculating frames per second
        world.lastTickTime = 0;
        world.fps = 0;

        world.Tile = new WorldJS.Tile();
        world.Knowledge = new WorldJS.Knowledge();
        world.Statistic = new WorldJS.Statistic();
        world.Rules = new WorldJS.Rules();

        // Call once every <tickPerYear> ticks
        world.yearPassedCallback = function() {};
    };

    /**
     * Insert the world into a HTML wrapper
     * wrapperId: id of an HTML wrapper element
     */
    WorldJS.prototype.init = function(wrapperId) {
        var world = this;

        // Add a canvas that fits size of its wrapper
        var canvas = document.createElement('canvas'),
            wrapper = world.canvas.wrapper = document.getElementById(wrapperId),
            // Size of the wrapper is also size of the world
            width = world.width = canvas.width = wrapper.clientWidth || world.width,
            height = world.height = canvas.height = wrapper.clientHeight || world.height;
        wrapper.appendChild(canvas);

        world.canvas.context = canvas.getContext('2d');

        // Load and cache sprite
        var sprite = new Image();
        sprite.src = world.sprite.src;
        world.sprite.image = sprite;

        world.Tile.init(world, width, height);

        return world;
    };

    /**
     * Add a seed to the world
     * Seed: seed-based class
     * data: properties of seed
     */
    WorldJS.prototype.add = function(Seed, data) {
        var world = this,
            seed = new Seed(data);

        // Save a reference of the world where the seed belongs
        seed.world = world;

        // Set an unique id
        seed.id = world.nextSeedId++;

        seed.age = data.age || 0;
        if (seed.age > 0) {
            seed.tickCount = seed.age * world.tickPerYear;
        }

        seed.tickMod = world.tickMod;

        seed.IQ += world.Rules.baseIQ;

        // Randomly set coordinate of the seed
        var random = function(min, max) {
            return Math.floor(Math.random() * (max - min + 1) + min);
        };
        if (seed.x === false) {
            seed.x = random(0, world.width - 1 - Math.max(seed.appearance.width, world.padding));
        }
        if (seed.y === false) {
            seed.y = random(0, world.height - 1 - seed.appearance.height - world.padding);
        }

        // Calculate tile index
        seed.tileIndex = world.Tile.getIndex(seed);
        // and cache the seed
        world.Tile.set(seed);

        // Put the seed in a frame which has lowest number of seeds occupied
        var distributedTicks = world.distributedTicks,
            minIndex = 0,
            minValue = distributedTicks[minIndex];
        for (var i = 0, len = distributedTicks.length; i < len; i++) {
            if (distributedTicks[i] < minValue) {
                minIndex = i;
                minValue = distributedTicks[i];
            }
        }
        distributedTicks[minIndex]++;
        seed.tickIndex = minIndex;

        // By modulusing <actionInterval> which equals half of tickPerYear by default
        // we have two lowest frames index: 30th (half year passed) and 60th (full year passed)
        seed.tickCount += (world.tickMod + seed.tickCount + minIndex) % seed.actionInterval;

        world.Statistic.seedAdded(seed);

        return world;
    };

    /**
     * Remove a seed from the world
     * seed: seed-based instance
     */
    WorldJS.prototype.remove = function(seed) {
        var world = this;

        world.Statistic.seedRemoved(seed);

        if (seed.married) {
            seed.married = false;
            seed.relationSeed.married = false;

            // Remove the references
            seed.relationSeed.relationSeed = false;
            seed.relationSeed = false;
        }

        world.Tile.rem(seed);

        world.distributedTicks[seed.tickIndex]--;

        return world;
    }

    /**
     * Add random people to the world
     * count: number of people to add
     * minAge, maxAge (optional)
     * fromBorder: determine people randomly appear or come from border
     *      0: random, 1: top, 2: bottom, 3: left, 4: right, 5: random border
     */
    WorldJS.prototype.addRandomPeople = function(count, minAge, maxAge, fromBorder) {
        var world = this,
            tickPerYear = world.tickPerYear,
            random = function(min, max) {
                return Math.floor(Math.random() * (max - min + 1) + min);
            };

        minAge = (typeof minAge === 'undefined') ? 15 : minAge,
        maxAge = (typeof maxAge === 'undefined') ? 20 : maxAge,
        fromBorder = (typeof fromBorder === 'undefined') ? 0 : fromBorder;

        // Add people to the world
        for (var i = 0; i < count; i++) {
            // Random age
            var age = random(minAge, maxAge),
                data = {
                    age: age,
                    tickCount: age * tickPerYear
                };

            if (fromBorder > 0) {
                var border = (fromBorder == 5) ?
                    random(1, 4) : fromBorder;
                switch (border) {
                    case 1: // top
                        data.y = 0;
                        break;
                    case 2: // bottom
                        data.y = world.height - 1;
                        break;
                    case 3: // left
                        data.x = 0;
                        break;
                    case 4: // right
                        data.x = world.width - 1;
                        break;
                }
            }

            if (i < count / 2) {
                world.add(world.Male, data);
            } else {
                world.add(world.Female, data);
            }
        }

        return world;
    };

    /**
     * World process loop
     */
    WorldJS.prototype.run = function(time) {
        var world = this,
            Statistic = world.Statistic,
            context = world.canvas.context,
            spriteImage = world.sprite.image;

        // Used for indicating a year
        // tickMod == 0 -> a year
        world.tickMod = (++world.tickMod) % world.tickPerYear;
        var yearPassed = world.tickMod === 0;

        // Draw the world every year instead of every frame if total seeds is too large
        var reDraw = (Statistic.population <= world.maxSafeSeedsForDisplay || yearPassed);

        // Clear canvas
        if (reDraw) {
            context.clearRect(0, 0, world.width, world.height);
        }

        var listTile = world.Tile.list,
            maxDisplayedSeeds = world.Tile.maxDisplayedSeeds,

            // Statistic
            sPopulation = 0,
            sIQ = 0,
            sMen = 0, sWomen = 0,
            sBoys = 0, sGirls = 0,
            sFamilies = 0;

        for (var i = 0, len = listTile.length; i < len; i++) {
            var seeds = listTile[i],
                displayedSeeds = 0;
            for (var j = 0, len2 = seeds.length; j < len2; j++) {
                if (seeds[j]) {
                    var seed = seeds[j],
                        oldTileIndex = seed.tileIndex;

                    /*
                     * When a seed moves to a different tile, its reference may be inserted into
                     * an empty spot of tile array instead of just appending to the array.
                     * That reference will possibly be available on next pass of the current loop
                     * which could cause a seed ticks twice.
                     */
                    if (seed.tickMod == world.tickMod) {
                        continue;
                    }
                    seed.tickMod = world.tickMod;

                    if (yearPassed) {
                        seed.age++;

                        // Statistic
                        sPopulation++;
                        sIQ += seed.IQ;
                        if (seed instanceof world.Male) {
                            if (seed.age <= seed.maxChildAge) {
                                sBoys++;
                            } else {
                                sMen++;
                                if (seed.married) {
                                    sFamilies++;
                                }
                            }
                        } else {
                            if (seed.age <= seed.maxChildAge) {
                                sGirls++;
                            } else {
                                sWomen++;
                            }
                        }
                    }

                    if (reDraw) {
                        // Not draw all seeds in a tile
                        if (displayedSeeds < maxDisplayedSeeds) {
                            // Draw current state of the seed
                            seed.draw(context, spriteImage);
                            displayedSeeds++;
                        }
                    }
                    // Seed moves around or triggers some actions
                    seed.tick();

                    // Update tiles if seed moves
                    var newTileIndex = world.Tile.getIndex(seed);
                    if (newTileIndex !== oldTileIndex) {
                        // Remove seed reference from old tile
                        world.Tile.rem(seed);

                        // Add seed reference to new tile
                        seed.tileIndex = newTileIndex;
                        world.Tile.set(seed);
                    }
                }
            }
        }

        if (yearPassed) {
            Statistic.yearPassed({
                population: sPopulation,
                IQ: sIQ,
                men: sMen,
                women: sWomen,
                boys: sBoys,
                girls: sGirls,
                families: sFamilies
            });

            world.Rules.change(world);
            world.Knowledge.gain(world);

            // Execute asynchronous callback
            setTimeout(function() {
                // Do HTML DOM manipulation in the callback
                world.yearPassedCallback.call(world);
            }, 1);

            if (sPopulation === 0) {
                // Stop the world
                world.running = false;
                return;
            }
        }

        // Loop animation
        if (world.running) {
            world.fps = 1000 / (time - world.lastTickTime);
            world.lastTickTime = time;

            requestAnimationFrame(world.run.bind(world));
        } else {
            // Trigger once
            world.stopCallback.call(world);
            world.stopCallback = function() {};
        }

        return world;
    };

    /**
     * Start the world
     */
    WorldJS.prototype.start = function() {
        this.running = true;
        this.run();
    }

    /**
     * Stop the world
     * callback (optional): callback trigger after the world stopped
     */
    WorldJS.prototype.stop = function(callback) {
        this.running = false;
        if (typeof callback === 'function') {
            this.stopCallback = callback;
        }
    }
})(window);