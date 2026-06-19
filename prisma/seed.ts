import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding database...');

  // Stories: 3 junior, 2 senior
  await prisma.story.createMany({
    skipDuplicates: true,
    data: [
      {
        ageBand: 'junior',
        title: 'The Little Seed',
        body: 'Once upon a time, a tiny seed fell into the warm earth. The rain came and gave it a drink of cool water. The sun shone brightly and warmed the ground. Slowly, a small green shoot pushed up through the soil. Every day it grew a little taller. Soon it had leaves that danced in the breeze. One morning a beautiful flower bloomed for all to see. The garden was filled with joy.',
        moral: 'With patience and care, wonderful things can grow.',
        emoji: '🌱',
        source: 'manual',
        date: null,
      },
      {
        ageBand: 'junior',
        title: 'The Friendly Cloud',
        body: 'High up in the sky lived a fluffy white cloud named Nimbus. Nimbus loved to make funny shapes for the children below. One hot day the children looked tired and sad. Nimbus decided to help by sending a cool, gentle breeze. Then Nimbus rained soft drops on the flowers in the park. The children laughed and danced in the light sprinkle. The flowers lifted their heads and smiled. Nimbus floated away feeling very happy indeed.',
        moral: 'A small act of kindness can brighten someone\'s whole day.',
        emoji: '☁️',
        source: 'manual',
        date: null,
      },
      {
        ageBand: 'junior',
        title: 'Pip the Brave Mouse',
        body: 'Pip was a tiny mouse who lived inside a big oak tree. One evening the wind howled and the rain poured down hard. Pip\'s little friend the robin had lost her nest. Pip gathered soft leaves and bits of bark to build a new one. It was hard work for such small paws but Pip did not give up. By bedtime the robin had a cosy new home up in the branches. She sang a sweet song of thanks into the night. Pip curled up and slept with a warm heart.',
        moral: 'Even the smallest friend can make the biggest difference.',
        emoji: '🐭',
        source: 'manual',
        date: null,
      },
      {
        ageBand: 'senior',
        title: 'The Dragon Who Feared Fire',
        body: 'In a kingdom nestled between two mountains lived a young dragon named Ember. Unlike all other dragons, Ember was afraid of his own fire. The other dragons laughed and called him a pebble-breath. One winter the village below the mountains grew terribly cold and the fires went out. The villagers shivered under their thin blankets. Ember watched from his cave and felt a pull in his chest. Gathering every bit of courage he had, he swooped down and breathed a long, warm flame into the village hearths. Fires crackled back to life and the villagers cheered. Ember realised his gift was not something to fear but something to share. From that day forward he visited the village every week, and the other dragons soon followed with respect in their eyes.',
        moral: 'Our greatest fears can become our greatest gifts when we face them with courage.',
        emoji: '🐉',
        source: 'manual',
        date: null,
      },
      {
        ageBand: 'senior',
        title: 'The Girl Who Collected Stars',
        body: 'Maya lived in a seaside town where the nights were very dark because the lighthouse had gone out. She had always loved astronomy and kept a notebook full of star maps. One night she noticed the ships were drifting dangerously without the lighthouse beam. Maya climbed the tall lighthouse with her notebook and a mirror. She polished the old mirror until it gleamed and used it to reflect the brightest star, Sirius, across the sea. The ships turned safely into harbour. The lighthouse keeper, who had fallen ill, woke the next morning to find the harbour full of grateful sailors. Maya was given the title of Junior Lighthouse Keeper and a telescope of her very own. She never stopped collecting stars after that night.',
        moral: 'Knowledge and creativity, used with bravery, can light the way for others.',
        emoji: '⭐',
        source: 'manual',
        date: null,
      },
    ],
  });

  // Poems: one per topic
  await prisma.poem.createMany({
    skipDuplicates: true,
    data: [
      {
        topic: 'Animals',
        title: 'The Happy Frog',
        lines: 'A little green frog sat on a log,\nSinging his song through the morning fog,\nHe hopped to the pond with a splish and a splash,\nAnd leapt back to shore in a bright emerald flash.',
        emoji: '🐸',
        source: 'manual',
      },
      {
        topic: 'Seasons',
        title: 'Four Friends',
        lines: 'Spring brings flowers, pink and new,\nSummer shines in golden hue,\nAutumn paints the leaves to red,\nWinter tucks the world to bed.',
        emoji: '🍂',
        source: 'manual',
      },
      {
        topic: 'Numbers',
        title: 'Counting to Five',
        lines: 'One little star blinks in the night,\nTwo yellow moons pour silver light,\nThree fluffy clouds go drifting by,\nFour happy birds sail through the sky,\nFive is the count — now wave goodbye!',
        emoji: '🔢',
        source: 'manual',
      },
      {
        topic: 'Colors',
        title: 'A Rainbow Day',
        lines: 'Red is the apple shining bright,\nBlue is the sky so full of light,\nYellow is the sun up high,\nGreen is the grass beneath the sky.',
        emoji: '🌈',
        source: 'manual',
      },
      {
        topic: 'Nature',
        title: 'The Whispering Wind',
        lines: 'The wind whispers secrets through tall swaying trees,\nIt ruffles the flowers and chases the bees,\nIt carries the seeds to a faraway place,\nAnd paints rosy colours on each little face.',
        emoji: '🌿',
        source: 'manual',
      },
    ],
  });

  // ABC lessons: all 26 letters
  const abcData = [
    { letter: 'A', word: 'Apple', emoji: '🍎', phonics: 'Say "ah" as in apple', miniStory: 'Amy found a big red apple under the old tree. She shared it with her friend Ant. Together they had the most delicious snack.' },
    { letter: 'B', word: 'Ball', emoji: '⚽', phonics: 'Say "buh" as in ball', miniStory: 'Ben kicked his blue ball into the garden. The ball bounced over the fence and landed in a bush. Ben laughed and climbed in to fetch it.' },
    { letter: 'C', word: 'Cat', emoji: '🐱', phonics: 'Say "kuh" as in cat', miniStory: 'Cleo the cat curled up on the cushion. She closed her eyes and purred softly. The whole room felt cosy and calm.' },
    { letter: 'D', word: 'Dog', emoji: '🐶', phonics: 'Say "duh" as in dog', miniStory: 'Dash the dog dug a hole in the garden. He found a shiny dinosaur toy inside. Dash was the happiest dog on the street.' },
    { letter: 'E', word: 'Egg', emoji: '🥚', phonics: 'Say "eh" as in egg', miniStory: 'Emma found an egg in the nest by the elm tree. She waited patiently every day. One morning a tiny bird hatched and said hello.' },
    { letter: 'F', word: 'Fish', emoji: '🐟', phonics: 'Say "ff" as in fish', miniStory: 'Finn the fish swam fast through the blue water. He found a field of sea flowers and stopped to look. It was the most fantastic place he had ever seen.' },
    { letter: 'G', word: 'Goat', emoji: '🐐', phonics: 'Say "guh" as in goat', miniStory: 'Gracie the goat climbed to the top of the green hill. She gazed at the giant sky above her. She felt great and did a little dance.' },
    { letter: 'H', word: 'Hat', emoji: '🎩', phonics: 'Say "huh" as in hat', miniStory: 'Harry found a huge hat in the attic. He put it on and it fell over his eyes. He hopped around the house making everyone laugh.' },
    { letter: 'I', word: 'Igloo', emoji: '🏠', phonics: 'Say "ih" as in igloo', mimiStory: null, miniStory: 'Isla built an igloo out of icy white blocks. Inside it was surprisingly warm and snug. She invited her friend to come in and have imaginary hot chocolate.' },
    { letter: 'J', word: 'Jar', emoji: '🫙', phonics: 'Say "juh" as in jar', miniStory: 'Jake found an old jar in the jungle. Inside was a map of a jungle adventure. He jumped with joy and set off to follow it.' },
    { letter: 'K', word: 'Kite', emoji: '🪁', phonics: 'Say "kuh" as in kite', miniStory: 'Kira flew her kite high in the kind breeze. It twisted and turned like a dancing butterfly. She kept running until her kite kissed the clouds.' },
    { letter: 'L', word: 'Lion', emoji: '🦁', phonics: 'Say "luh" as in lion', miniStory: 'Leo the lion lay under a large leafy tree. A little ladybird landed on his nose. Leo laughed gently so he would not blow the ladybird away.' },
    { letter: 'M', word: 'Moon', emoji: '🌙', phonics: 'Say "mmm" as in moon', miniStory: 'Mia looked out her window at the magic moon. It seemed so close she could touch it. She made a wish and fell asleep smiling.' },
    { letter: 'N', word: 'Nest', emoji: '🪺', phonics: 'Say "nnn" as in nest', miniStory: 'Nina found a tiny nest in the neighbour\'s garden. It was woven with neat twigs and soft moss. Inside were three blue eggs waiting to hatch.' },
    { letter: 'O', word: 'Owl', emoji: '🦉', phonics: 'Say "oh" as in owl', miniStory: 'Oliver the owl opened his orange eyes at dusk. He observed the forest from his oak tree branch. He hooted once and the other animals felt safe.' },
    { letter: 'P', word: 'Penguin', emoji: '🐧', phonics: 'Say "puh" as in penguin', miniStory: 'Pablo the penguin wore a smart black and white suit. He waddled to the pond to play with his pals. They all slid on the ice together and laughed.' },
    { letter: 'Q', word: 'Queen', emoji: '👑', phonics: 'Say "kwuh" as in queen', miniStory: 'Quinn was a kind queen who ruled a quiet kingdom. She gave every child a question to solve each morning. The cleverest answer won a golden quill.' },
    { letter: 'R', word: 'Rainbow', emoji: '🌈', phonics: 'Say "rrr" as in rainbow', miniStory: 'Rosa ran outside after the rain stopped. A huge rainbow stretched across the rosy sky. She reached out her hand as if she could touch the red stripe.' },
    { letter: 'S', word: 'Sun', emoji: '☀️', phonics: 'Say "sss" as in sun', miniStory: 'Sam woke up early to see the sunrise. The sun stretched its golden arms across the sky. Sam smiled and said good morning to the world.' },
    { letter: 'T', word: 'Tiger', emoji: '🐯', phonics: 'Say "tuh" as in tiger', miniStory: 'Tara the tiger tiptoed through the tall grass. She tried to catch a butterfly but it flew too fast. Tara tickled the grass with her tail instead.' },
    { letter: 'U', word: 'Umbrella', emoji: '☂️', phonics: 'Say "uh" as in umbrella', miniStory: 'Uma forgot her umbrella on a rainy day. She used a giant leaf from the garden instead. Underneath it she stayed perfectly dry.' },
    { letter: 'V', word: 'Volcano', emoji: '🌋', phonics: 'Say "vvv" as in volcano', miniStory: 'Victor drew a volcano for his school project. He made it bubble with vinegar and baking soda. Everyone in the class was very impressed.' },
    { letter: 'W', word: 'Whale', emoji: '🐋', phonics: 'Say "wuh" as in whale', miniStory: 'Willow the whale swam through warm water. She waved her wide tail at the passing boats. The sailors waved back and felt wonderfully lucky.' },
    { letter: 'X', word: 'Xylophone', emoji: '🎵', phonics: 'Say "zz" as in xylophone', miniStory: 'Xavier found a xylophone in the music box. He tapped each bar and listened to the bright notes. He played a little extra-special song just for fun.' },
    { letter: 'Y', word: 'Yak', emoji: '🦬', phonics: 'Say "yuh" as in yak', miniStory: 'Yolanda met a yak on a yellow hillside. The yak had long shaggy fur and kind brown eyes. Yolanda yelled hello and the yak yawned in a friendly way.' },
    { letter: 'Z', word: 'Zebra', emoji: '🦓', phonics: 'Say "zzz" as in zebra', miniStory: 'Zara the zebra had the most amazing stripes. She zigzagged through the zoo at top speed. All the other animals cheered as she zoomed past.' },
  ].map(({ mimiStory: _unused, ...rest }) => ({ ...rest, source: 'manual' }));

  for (const lesson of abcData) {
    await prisma.abcLesson.upsert({
      where: { letter: lesson.letter },
      update: lesson,
      create: lesson,
    });
  }

  // Crawl sources
  await prisma.crawlSource.createMany({
    skipDuplicates: true,
    data: [
      { url: 'https://www.storyberries.com/category/bedtime-stories/', contentType: 'story', status: 'pending' },
      { url: 'https://www.kidsgen.com/poems/', contentType: 'poem', status: 'pending' },
      { url: 'https://www.starfall.com/h/abcs/', contentType: 'abc', status: 'pending' },
      { url: 'https://www.pitara.com/fiction-for-kids/stories-for-kids/', contentType: 'story', status: 'pending' },
      { url: 'https://www.poetry4kids.com/', contentType: 'poem', status: 'pending' },
    ],
  });

  console.log('Seeding complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
