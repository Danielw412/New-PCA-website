-- Import the 2023-2024 and 2024-2025 historical event archive.
-- Historical records are published but cannot accept new registrations. For
-- multi-date activities, event_date is the first fully specified date supplied
-- by PCA and the complete date list remains in the description.

update public.events
set
    title = 'Mid-Autumn Festival',
    description = 'The PCA Youth Student Council held their annual Mid-Autumn Festival. The event included various activities such as lantern painting, face painting, paper cutting, and most importantly, mooncakes!',
    location = 'Mt. Lebanon Park',
    event_date = date '2023-09-23',
    starts_at = timestamptz '2023-09-23 18:00:00+00',
    ends_at = timestamptz '2023-09-23 21:00:00+00',
    registration_open = false,
    published = true
where replace(lower(title), '-', ' ') = 'mid autumn festival'
  and event_date = date '2023-09-23'
  and deleted_at is null;

with incoming(title, description, location, event_date, starts_at, ends_at) as (
    values
        (
            'Western Pennsylvania Conservancy Events',
            E'PCA Youth Center participated in various events hosted by the Western Pennsylvania Conservancy! Volunteering opportunities included tree planting, garden planting, community garden cleanups, and more!\n\nDates: 09/30/23, 04/20/24, 05/04/24, 06/01/24',
            null,
            date '2023-09-30',
            null,
            null
        ),
        (
            'Hilltop Urban Farm Events',
            E'PCA Youth Center participated in various volunteer events hosted by the Hilltop Urban Farm. Volunteers worked on tasks in planting, harvesting, weeding, mulching, and orchard care.\n\nDates: 10/21/23, 5/18/24, 7/20/24',
            null,
            date '2023-10-21',
            null,
            null
        ),
        (
            'Greater Pittsburgh Food Bank',
            E'PCA Youth Center participated in multiple volunteer events for the Greater Pittsburgh Food Bank. Volunteers provided hundreds of individuals and families with at least 50 pounds of food by loading pre-packed boxes into cars at food drives.\n\nDates: 10/28/23, 12/23, 6/22/24',
            null,
            date '2023-10-28',
            null,
            null
        ),
        (
            'Art Show',
            'PCA Youth Student Council hosted an art show including fun stations like blind drawing, a huge collaborative painting, a raffle, and much more! Works from many talented local artists were also displayed.',
            'Mt. Lebanon Library',
            date '2023-11-25',
            timestamptz '2023-11-25 18:00:00+00',
            timestamptz '2023-11-25 21:00:00+00'
        ),
        (
            'Online Career Talk',
            E'The PCA Youth Student Council hosted an online career presentation event, featuring four presenters who inspired students and helped them discover new career prospects.\n\nSpeaker Lineup:\n- Lead Policy Officer at World Bank:\nYuan Tao - Saturday, January 13th, 2024\n\n- Branch Manager at JPMorgan Chase:\nLeonela Pascual - Saturday, January 13th, 2024\n\n- Department Chair of Marketing at West Virginia University:\nAnnie Cui - Saturday, January 20th, 2024\n\n- Clinical Pharmacist:\nHelen Feinstein - Saturday, January 20th\n\nDate: Saturday, January 13th, 2024 and Saturday, January 20th, 2024\nTime: 5:00 PM - 7:00 PM\nLocation: Zoom meeting',
            'Zoom meeting',
            date '2024-01-13',
            timestamptz '2024-01-13 22:00:00+00',
            timestamptz '2024-01-14 00:00:00+00'
        ),
        (
            'Ronald McDonald House Door Decoration',
            E'PCA Youth Center helped Ronald McDonald House Pittsburgh decorate guest room doors in the spring and winter. Volunteers created and hung seasonal door decorations to welcome and comfort families staying at charity homes while their children received life-saving medical care at nearby hospitals.\n\nDates: 03/02/24, 11/23/24',
            null,
            date '2024-03-02',
            null,
            null
        ),
        (
            'Earth Day',
            'The PCA Youth Center hosted an Earth Day event to inspire children to learn more about nature through fun activities such as learning the art of rock painting, participating in scavenger hunts, and creating delicious Earth Day dirt cups from chocolate pudding.',
            'North Park Olympia Shelter',
            date '2024-04-27',
            timestamptz '2024-04-27 17:00:00+00',
            timestamptz '2024-04-27 19:30:00+00'
        ),
        (
            'Field Day',
            'The PCA Youth Center hosted a Field Day Event, filling two joyful hours with a variety of fun games such as Tug of War, Capture the Flag, chopsticks M&Ms, relay activities, and ending with an exhilarating water balloon showdown.',
            'South Park Outlook Shelter',
            date '2024-06-16',
            timestamptz '2024-06-16 18:00:00+00',
            timestamptz '2024-06-16 20:00:00+00'
        ),
        (
            'Mid Autumn Festival',
            'The PCA Youth Center celebrated the Mid Autumn Festival, helping participants deepen their connections with Chinese culture through entertaining activities like decorating and eating mooncakes, making lanterns, and face painting.',
            'North Park - Deer Browse 1 Shelter',
            date '2024-09-14',
            timestamptz '2024-09-14 18:00:00+00',
            timestamptz '2024-09-14 20:00:00+00'
        ),
        (
            'Pittsburgh Chinese Cultural Festival',
            'The PCA Youth Center participated in the annual Pittsburgh Chinese Cultural Festival at Mellon with an activity booth featuring fun activities like face painting and craftmaking.',
            'Mellon Park',
            date '2024-09-21',
            null,
            null
        ),
        (
            'Western Pennsylvania Conservancy Events',
            E'PCA Youth Center volunteered for various events hosted by the Western Pennsylvania Conservancy. Events included garden cleanups and planting.\n\nDates: 10/05/24, 10/19/24, 11/23/24, 05/03/25, 06/07/25',
            null,
            date '2024-10-05',
            null,
            null
        ),
        (
            'Autumn Culture Fest',
            'The PCA Youth Center hosted their first Autumn Cultural Fest, blending the celebration of autumn’s arrival with Chinese culture. The fun filled afternoon included activities such as Chinese games, mini olympics, a scavenger hunt, leaf collages, and bracelet making.',
            'Mt. Lebanon Park',
            date '2024-10-19',
            timestamptz '2024-10-19 18:00:00+00',
            timestamptz '2024-10-19 20:00:00+00'
        ),
        (
            'Greater Pittsburgh Food Bank',
            E'PCA Youth Center participated in multiple volunteer events for the Greater Pittsburgh Food Bank. Volunteers provided hundreds of individuals and families with at least 50 pounds of food by loading pre-packed boxes into cars at food drives. PCA also organized a fundraising drive, raising $300 dollars for the food bank.\n\nDate: 10/26/23',
            null,
            date '2023-10-26',
            null,
            null
        ),
        (
            'Ronald McDonald House Pittsburgh Door Decoration',
            'PCA Youth Center helped Ronald McDonald House Pittsburgh decorate guest room doors for the winter holiday season. Volunteers created and hung seasonal door decorations to welcome and comfort families staying at charity homes while their children received life-saving medical care at nearby hospitals.',
            null,
            date '2024-11-23',
            null,
            null
        ),
        (
            'Play It forward Pittsburgh: Jingles and Gingerbread',
            E'The PCA Youth Center held a craft activity and a volunteer event to sort donated toys for the Play It Forward Pittsburgh organization. Both events were great successes!\n\nDates: December 9 and 10, 2024',
            null,
            date '2024-12-09',
            null,
            null
        ),
        (
            'CAST-P Lunar New Year Celebration',
            'PCA Youth Center celebrated Lunar New Year at the CAST-P Spring Festival Gala with an activity table featuring pitch pots and spin wheels!',
            null,
            date '2025-01-26',
            null,
            null
        ),
        (
            'Online Career Talk',
            E'The PCA Youth Center hosted a continuation of the career speaker series, allowing participants to learn from industry leaders, gain insights into different career paths, and ask questions to professionals.\n\nSpeakers:\n- Dr. Nicole McNeer, Senior Medical Director, Oncology Global Clinical Lead at Servier: leads groundbreaking work in cancer research and treatment\n- Mr. Vik Sharma, Market Director at JP Morgan Chase: manages branch managers in the Pittsburgh market to optimize business results',
            'Zoom meeting',
            date '2025-02-23',
            timestamptz '2025-02-23 20:00:00+00',
            timestamptz '2025-02-23 22:30:00+00'
        ),
        (
            'Hilltop Urban Farm Event',
            E'PCA Youth Center participated in various volunteer events hosted by the Hilltop Urban Farm. Volunteers worked on tasks in planting, harvesting, weeding, mulching, and orchard care.\n\nDate: April 05 2025',
            null,
            date '2025-04-05',
            null,
            null
        ),
        (
            'Mothers Day crafts event',
            'PCA Youth Center celebrated Mother’s Day with a joyful time filled with a variety of fun activities including homemade flower bouquets, finger painting and hand painting, and Mother’s Day cards.',
            'Sewickley Public Library',
            date '2025-05-10',
            timestamptz '2025-05-10 17:00:00+00',
            timestamptz '2025-05-10 18:30:00+00'
        ),
        (
            'AANHPI Month Celebration',
            'PCA Youth Center celebrated AANHPI month with an activity table at Carnegie Museum where participants created crafts such as paper cutting and bookmark decoration!',
            'Carnegie Museum',
            date '2025-05-18',
            null,
            null
        ),
        (
            'Summer Field Day',
            E'The PCA Youth Center held their annual Field Day Event, filling two fun hours with a variety of fun games such as Tug of War, Capture the Flag, relay activities, and a water balloon fight!\n\nDate: Sunday, June 14\nTime: 2:00 PM - 4:00 PM\nLocation: South Park Sunny Wood Shelter',
            'South Park Sunny Wood Shelter',
            date '2025-06-14',
            timestamptz '2025-06-14 18:00:00+00',
            timestamptz '2025-06-14 20:00:00+00'
        )
)
insert into public.events (
    title,
    description,
    location,
    event_date,
    starts_at,
    ends_at,
    capacity,
    max_participants_per_registration,
    registration_open,
    published
)
select
    incoming.title,
    incoming.description,
    incoming.location,
    incoming.event_date,
    incoming.starts_at,
    incoming.ends_at,
    50,
    6,
    false,
    true
from incoming
where not exists (
    select 1
    from public.events as existing
    where replace(lower(existing.title), '-', ' ') = replace(lower(incoming.title), '-', ' ')
      and existing.event_date = incoming.event_date
      and existing.deleted_at is null
);
