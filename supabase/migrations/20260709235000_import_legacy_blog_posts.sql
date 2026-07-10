-- Import the five most recent posts visible on the former PCA blog at the time
-- of migration. Available cover images are stored in images/blog; posts that
-- did not expose a cover image remain intentionally image-free.

insert into public.blog_posts (
    slug, title, excerpt, content_version, content,
    cover_image_source, cover_image_path, cover_image_alt,
    status, author_user_id, author_display_name, published_at, created_at, updated_at
)
values
(
    'chinese-cultural-festival',
    'Chinese Cultural Festival',
    'On September 13th, the PCA Youth Center participated in the annual Chinese Cultural Festival held at Mellon Park, sharing activities and Chinese culture with thousands of visitors.',
    1,
    $content$[
      {"type":"paragraph","text":"On September 13th, the PCA Youth Center participated in the annual Chinese Cultural Festival held at Mellon Park. The Chinese Cultural Festival, which boasts more than 5,000 visitors, hosts various booths showcasing different aspects of Chinese culture: endless cuisines, traditional dances, live music, handcrafted goods, games, and much more."},
      {"type":"paragraph","text":"The PCA Youth Center had its own booth featuring various activities. As usual, the booth featured face painting by talented volunteers. Additionally, PCA Youth Center sold fans and bookmarks handmade by dedicated volunteers as well as customizable wax seals featuring the 12 Chinese Zodiac animals."},
      {"type":"paragraph","text":"The Chinese Cultural Festival was a blast! We hope to see you there next year!"}
    ]$content$::jsonb,
    null, null, null,
    'published', null, 'puppiescasey',
    '2025-09-13 12:00:00-04'::timestamptz,
    '2025-09-13 12:00:00-04'::timestamptz,
    '2025-09-13 12:00:00-04'::timestamptz
),
(
    '2025-orientation-day',
    '2025 Orientation Day',
    'As summer drew to a close, new and returning PCA Youth Center members gathered in Bethel Park to begin the 2025–2026 season together.',
    1,
    $content$[
      {"type":"paragraph","text":"As the days get shorter and summer draws to a close, the PCA Youth Center moves onto its next chapter: the 2025-2026 season. To mark this occasion, on August 16th, new and old members alike were welcomed to an orientation day at Bethel Park."},
      {"type":"paragraph","text":"To start off the afternoon, the PCA Youth Center Student Council co-presidents—Zoey Guo and Angelina Li—outlined the goals for the PCA Youth Center, expectations for members in the student council as well as general policies. Then, the rest of the officers in the student council introduced themselves: advisors Ava Liu and Shirley Deng, vice presidents Joanna Bi and Lynsey Zhao, PR director Elena Xiao, secretary Joy Zhang, and webmaster Casey Yang."},
      {"type":"paragraph","text":"After introductions were complete, it was time for the fun part of the afternoon: ice breakers. The student council started with the classic hamburger game, which is when one person starts by saying their name and something to add to the imaginary hamburger—which at orientation, ranged anywhere from onions to wood—then, the second person would have to repeat the first person’s name and ingredient as well as their own name and ingredient. This process would then be repeated for each person, adding more and more to the PCA Youth Center hamburger."},
      {"type":"paragraph","text":"After the hamburger game, the student council moved on to playing Stand Up If. It turns out that almost everyone has walked into the wrong classroom before or thought someone was waving to them when they were not. Once everyone’s most embarrassing moments had been revealed, the student council moved on to playing Common Ground, a game where smaller groups were formed and competed with other groups to find the most amount of things in common with one another as well as the most niche. Groups all came up with unique commonalities like all liking their toilet paper over."},
      {"type":"paragraph","text":"As Common Ground wrapped up, farewells were said and this exhilarating afternoon concluded. PCA Youth Center is excited to see where this new season takes it!"}
    ]$content$::jsonb,
    'local', 'images/blog/2025-orientation-day.avif', 'PCA Youth Center 2025 Orientation Day',
    'published', null, 'puppiescasey',
    '2025-08-23 12:00:00-04'::timestamptz,
    '2025-08-23 12:00:00-04'::timestamptz,
    '2025-08-23 12:00:00-04'::timestamptz
),
(
    'summer-field-day-2025',
    'Summer Field Day',
    'PCA Youth Center Student Council celebrated summer with an afternoon of cornhole, capture the flag, relay races, tug of war, and water balloons.',
    1,
    $content$[
      {"type":"paragraph","text":"On June 15th, the PCA Youth Center Student Council celebrates the warming summer days with the annual Field Day event, a fun-filled afternoon for children wanting to spend a few hours under the sun’s gentle warmth."},
      {"type":"paragraph","text":"To start the day, children signed in and received colored wristbands. After which, they promptly headed over to the ongoing cornhole game, where participants competed in attempting to throw bean bags into their respective target holes."},
      {"type":"paragraph","text":"As more children arrived and the competitive spirit was high, participants switched to the exhilarating game of capture the flag. Players were divided based on the color of their wristbands—either red or yellow—and led to their respective sides of the field. After the goal of the game—to steal the other team’s flag—was explained, volunteers counted down and the game officially started. Participants rushed to the line dividing the two sides, attempting to find weak spots to exploit. Unfortunately, victory was not in the cards for Team Yellow, as Team Red achieved three decisive victories after fierce competition."},
      {"type":"paragraph","text":"To cool off, participants moved on to the next game: Sponge Relay. Participants were once again divided into their teams based on wristband color and excitedly waited for the game to begin. Once the timer was started, players in each team took turns dunking their sponge in a bucket of water and running the sopping-wet sponge to the empty bucket on the opposite side of the field. As the water level in the original bucket rapidly dropped, apprehension rose as the victor was soon to be decided. In a close race, Team Yellow recovered the victory with just a few seconds to spare."},
      {"type":"paragraph","text":"Next, the children moved on to a classic game: tug of war. Teams lined up on either side of a large rope, with each member grabbing a section of the rope. When the game’s start was announced, each team member threw their whole strength into pulling the rope toward their side of the field. The teams were evenly matched, with victories being given to both teams."},
      {"type":"paragraph","text":"After having a quick snack break, it was time for the grand finale, what everyone had been waiting for, and why some were dressed in bathing suits; it was water balloon time. Participants started with the simple game of catch but with a twist. With each successful catch, the players would take a step back and failure to catch meant an explosion of water. Afterwards, the water balloons were refilled and each participant grabbed one—or for some, quite a few—and waited for the go signal. When it was given, water balloons flew and children’s laughter filled the air as the water balloon fight began. Finally, to conclude the joyful day and to continue an annual tradition, a bucket of water was dumped over the head of the PCA Youth Center Student Council’s future president. We hope to see you at our next event!"}
    ]$content$::jsonb,
    'local', 'images/blog/summer-field-day.avif', 'Children and volunteers at PCA Summer Field Day',
    'published', null, 'puppiescasey',
    '2025-07-13 12:00:00-04'::timestamptz,
    '2025-07-13 12:00:00-04'::timestamptz,
    '2025-07-13 12:00:00-04'::timestamptz
),
(
    'pca-autumn-cultural-fest',
    'PCA Autumn Cultural Fest',
    'PCA Youth Center blended crisp autumn weather with Chinese culture through bracelet making, leaf collages, a Mini Olympics, and a scavenger hunt.',
    1,
    $content$[
      {"type":"paragraph","text":"As the leaves turned from vibrant green to a beautiful ombre of reds, oranges, and yellows, the PCA Youth Center hosted an exciting Autumn Cultural Fest, blending the warm autumn air with a celebration of Chinese culture through a variety of engaging activities."},
      {"type":"paragraph","text":"Participants began with a bracelet-making station, where they used colorful string and beads to create unique accessories. The array of bracelets, spanning all the colors of the rainbow, gleamed proudly on the wrists of their creators."},
      {"type":"paragraph","text":"Another popular activity was leaf collaging. Participants embarked on a short nature walk to appreciate the beauty of autumn and gather the perfect leaves for their masterpieces. After the walk, they glued their chosen leaves into place and added details with colored pencils, markers, and crayons, turning each collage into a personalized work of art."},
      {"type":"paragraph","text":"In the latter part of the afternoon, the pace picked up with a lively Mini Olympics. Participants competed in Tug of War, straining to pull the opposing team over the line; Sack Races, hopping in potato sacks toward the finish line as quickly as possible; and Bean Bag Toss, a test of precision and aim. Each game brought new peaks of excitement!"},
      {"type":"paragraph","text":"The day wrapped up with a thrilling scavenger hunt, where participants raced to find hidden objects in the outdoors. With the grand prize of candy on the line, the hunt provided an exciting conclusion to this year’s Autumn Cultural Fest."},
      {"type":"paragraph","text":"We can’t wait to see everyone again next year!"}
    ]$content$::jsonb,
    null, null, null,
    'published', null, 'Joanna Bi',
    '2024-11-09 12:00:00-05'::timestamptz,
    '2024-11-09 12:00:00-05'::timestamptz,
    '2024-11-09 12:00:00-05'::timestamptz
),
(
    'mid-autumn-festival-2024',
    'Mid-Autumn Festival!',
    'North Park filled with cultural stories, creative crafts, mooncakes, lanterns, propeller toys, and face painting for PCA''s Mid-Autumn Festival celebration.',
    1,
    $content$[
      {"type":"paragraph","text":"September 14th was an afternoon filled with cultural stories, creative crafts, and delicious mooncakes in the Mid-Autumn Festival celebration at North Park! Here's a glimpse into what made the event so special—and why you won’t want to miss it next year!"},
      {"type":"paragraph","text":"The festival kicked off with participants signing in at the welcome table, where they received mooncakes—the traditional delicacy of the Mid-Autumn Festival."},
      {"type":"paragraph","text":"One of the most captivating parts of the day was the storytelling and crafts table. Volunteers like Angelina Li and Hanna Qian brought ancient Chinese myths to life, sharing the tales of Chang’e & Hou Yi, the Jade Rabbit, and Wu Gang & the Cherry Bay. The fusion of creativity and culture made this one of the most memorable activities for families."},
      {"type":"paragraph","text":"Participants got a chance to craft their very own Chinese lanterns using colored paper, stickers, and markers at the lantern-making table. The hands-on nature of this activity made it a hit with both kids and parents. Many families proudly took home their colorful creations as keepsakes."},
      {"type":"paragraph","text":"The propeller toy station was another crowd-pleaser. Using popsicle sticks and bamboo, kids created traditional Chinese propeller toys that they could actually launch into the air! It was a great way for everyone to enjoy a simple yet interactive cultural craft."},
      {"type":"paragraph","text":"The mooncake decorating table was a special event for younger participants. The kids had a blast using clay and molds to create their own colorful, mini-mooncake designs. They weren’t edible, but they still got to take their creations home as souvenirs!"},
      {"type":"paragraph","text":"The face-painting station was a smash hit from the beginning. With the help of our talented volunteers, kids transformed into everything from mythical characters to festive symbols. Volunteers and participants alike had fun creating these moments."},
      {"type":"paragraph","text":"The success of the Mid-Autumn Festival was made possible by the dedication of all the volunteers and organizers who worked hard to create a wonderful environment. From the thoughtful setup to the careful planning of activities, every detail contributed to making the festival a true celebration of Chinese culture and community spirit."},
      {"type":"paragraph","text":"For those who couldn’t attend this year, next year’s festival will be just as exciting! So, mark your calendars and get ready to experience the magic of the Mid-Autumn Festival in 2025. We can’t wait to see you there!"}
    ]$content$::jsonb,
    'local', 'images/blog/mid-autumn-festival-2024.avif', 'PCA Mid-Autumn Festival activities at North Park',
    'published', null, 'Joanna Bi',
    '2024-09-28 12:00:00-04'::timestamptz,
    '2024-09-28 12:00:00-04'::timestamptz,
    '2024-09-28 12:00:00-04'::timestamptz
)
on conflict (slug) do nothing;

